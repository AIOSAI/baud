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
//!
//! Milestone 7 makes the fleet view SEATABLE: a sealed `<NAME>_REGISTRY.json`
//! marks a directory as a project, and BAUD can seat its whole read surface -
//! fleet scan, fence, new shells - in any project it discovered ITSELF: the
//! anchor tree it launched from, `projects/*` nested inside it, and the
//! anchor's sibling directories. The frontend never names a path; it picks
//! from the backend's census by NAME, so where BAUD reads stays backend-owned
//! even with a switcher in the header. Rooms in a non-anchor project carry
//! the project in their session name (`baud-<project>-<branch>`) so two
//! projects' same-named branches can never attach to each other's sessions;
//! anchor rooms keep the plain names they have always had.
//!
//! Milestone 12 answers the room-end ruling (Patrick, 2026-08-12): an ended
//! room stays dead until the operator opens the card again. The half of that
//! which lives here is the OUTSIDE session - a live claude sitting in a tmux
//! session BAUD never created (@hooks' boot shim names them `aipass-<branch>`,
//! the Telegram fleet `telegram-<branch>`). The old room lookup only ever
//! asked "does `baud-<branch>` exist", so those agents were immortal from the
//! UI: `end room` targeted a session that did not exist and silently did
//! nothing while the card truthfully showed the agent alive. The snapshot now
//! reads panes, not just session names, and a branch whose own room is absent
//! reports the outside session that holds its claude. The card's doors act on
//! whichever session is actually there - BAUD still CREATES only its own
//! rooms.
//!
//! Milestone 11 breaks the read-only streak on purpose: [`settings`] writes
//! two config files - claude's `<branch>/.claude/settings.local.json` and
//! BAUD's own `.aipass/baud.settings.json`. It touches only the keys it
//! declares, refuses to write at all when the existing file does not parse,
//! and replaces files by rename so a reader never sees a half-write. No
//! other command in this codebase writes anything.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

mod memory;
mod notifications;
mod pty;
mod screenshot;
mod settings;

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
    /// The project this branch belongs to. Every card carries it, because a
    /// roster card can be from a project the view is not seated in and its
    /// doors must act in ITS scope, not the seat's - a room name carries its
    /// project, so resolving `devpulse` under the wrong scope would attach a
    /// session that never existed.
    pub project: String,
    /// Absolute branch directory - what the launch button cds into.
    pub path: String,
    /// `.trinity/passport.json` exists.
    pub is_citizen: bool,
    /// The passport's `identity.citizen_class` reads "manager" - a project's
    /// first agent, its owner. Managers alone hold git write, the feedback
    /// channel and watchdog; every agent spawned into a project afterwards is
    /// not one. False for a builder, a non-citizen, and any passport BAUD
    /// cannot read - the mark is only ever claimed when the file says so.
    pub manager: bool,
    /// The passport's `identity.citizen_class` VERBATIM, or empty when there is
    /// no passport, no key, or nothing BAUD could read.
    ///
    /// `manager` above is this field asked one narrow question, and it stays
    /// because half the app asks exactly that question. This carries the whole
    /// answer so the passport view can PRINT the class, and so a class AIPass
    /// invents next month arrives without a second plumbing trip through the
    /// snapshot, the types file and the transports.
    pub citizen_class: String,
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
    /// The name of THIS branch's own room - `baud-<branch>` in the anchor,
    /// `baud-<project>-<branch>` elsewhere, sanitized for tmux targets.
    ///
    /// Always spelled, whether or not the session exists: it is the name the
    /// room HAS if it is live and the name it would be CREATED with if it is
    /// not, which are the same string. [`has_room`](Self::has_room) says which
    /// of the two you are looking at.
    ///
    /// PUBLISHED BECAUSE THIS DERIVATION HAD BEEN COPIED (FPLAN-0438, on
    /// @seedgo's finding). @api's attach lane re-implemented the prefix, the
    /// scope rule and the character sanitizer in python to work out which
    /// session to attach the phone to - and a naming rule living in two
    /// runtimes is a rule that will disagree with itself the first time either
    /// side changes it, with the failure landing as "attached to a session
    /// that never existed" rather than as an error. BAUD names its own rooms,
    /// so BAUD says the name. Read this field; never rebuild it.
    ///
    /// NOT ALWAYS THE SESSION A DOOR ACTS ON, and that distinction is the
    /// whole of m12: when `has_room` is false, the branch's live claude may be
    /// sitting in a session BAUD never made, and
    /// [`outside_room`](Self::outside_room) names it. The resolution is: own
    /// room if it exists, else `outside_room`, else this name to create.
    pub room: String,
    /// A `baud-<branch>` tmux session exists - the agent has a living room
    /// to attach to, whether or not anything is running inside it.
    pub has_room: bool,
    /// A live claude sitting in a tmux session BAUD did NOT create, with its
    /// pane seated in this branch - the boot shim's `aipass-<branch>`, a
    /// `telegram-<branch>` wake, a hand-rolled session. Only ever set when
    /// the branch's own room is absent, so the card knows which session its
    /// doors will act on. `None` is the ordinary case (m12).
    pub outside_room: Option<String>,
    /// Sub-agents running inside this branch's live claude session(s) right
    /// now - unmatched Agent/Task spawn calls in recent transcripts. See
    /// [`count_inflight_subagents`].
    pub subagents: u64,
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
    fn new(name: String, project: String, path: String) -> Self {
        Self {
            name,
            project,
            path,
            is_citizen: false,
            manager: false,
            citizen_class: String::new(),
            dispatched: false,
            interactive: false,
            has_history: false,
            resume_id: None,
            room: String::new(),
            has_room: false,
            outside_room: None,
            subagents: 0,
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
    /// The seated project's canonical name. Empty when resolution failed.
    pub project: String,
    /// The seated project's root, for display. Empty when resolution failed.
    pub root: String,
    /// ISO-8601 UTC timestamp of this snapshot.
    pub generated_at: String,
    /// Human-readable reason the snapshot is empty or partial.
    pub error: Option<String>,
    /// One entry per directory under the seated project's fleet dir.
    pub branches: Vec<BranchStatus>,
    /// Every tmux session on the machine holding a live INTERACTIVE claude,
    /// sorted. Deliberately NOT scoped to the seat: the terminal can be
    /// attached to a room belonging to a project the fleet view is not
    /// currently showing, and its slash-command chips have to know whether a
    /// chat box exists there. Keyed by session name, which is what the pty
    /// actually attached to.
    pub live_agent_sessions: Vec<String>,
}

impl FleetSnapshot {
    fn failed(error: String) -> Self {
        Self {
            project: String::new(),
            root: String::new(),
            generated_at: now_iso8601(),
            error: Some(error),
            branches: Vec::new(),
            live_agent_sessions: Vec::new(),
        }
    }
}

fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub(crate) fn join_all(base: &Path, parts: &[&str]) -> PathBuf {
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
pub(crate) fn resolve_aipass_root() -> Result<PathBuf, String> {
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

/// The seal that turns a directory into a project: `<NAME>_REGISTRY.json` in
/// its root. The filename stem IS the canonical project name - the same
/// convention the wider ecosystem resolves external projects by.
const REGISTRY_SUFFIX: &str = "_REGISTRY.json";

/// Where a project keeps nested projects (AIPass keeps baud itself here).
const PROJECTS_SUBDIR: &str = "projects";

/// One project BAUD can seat its read surface in.
#[derive(Debug, Clone, Serialize)]
pub struct Project {
    /// Canonical name from the registry filename: `VERA-STUDIO_REGISTRY.json`
    /// seals "VERA-STUDIO".
    pub name: String,
    /// Absolute project root - the fence while this project is seated.
    pub root: PathBuf,
    /// Absolute directory the branch cards come from.
    pub fleet_dir: PathBuf,
    /// True for the anchor - the AIPass tree BAUD resolved at launch.
    pub anchor: bool,
}

impl Project {
    /// The room-name scope for this project's branches: anchor rooms keep
    /// their historical plain names, everyone else's carry the project.
    pub(crate) fn room_scope(&self) -> Option<String> {
        (!self.anchor).then(|| self.name.to_lowercase())
    }
}

/// One row of the switcher menu.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectListing {
    pub name: String,
    pub root: String,
    pub anchor: bool,
    pub active: bool,
}

/// Which project the fleet view, the fence, and new shells follow.
///
/// `None` means the anchor. Only [`project_switch`] ever writes it, and only
/// to a project the backend discovered itself - the frontend cannot steer
/// BAUD into an arbitrary directory by name or by path.
#[derive(Default)]
pub struct ActiveProject(Mutex<Option<Project>>);

/// The registry file sealing `dir`, if any. Legacy trees can carry several;
/// the lexically first wins so the answer never depends on readdir order.
fn registry_in(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut seals: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .map(|name| {
                        let name = name.to_string_lossy();
                        name.len() > REGISTRY_SUFFIX.len() && name.ends_with(REGISTRY_SUFFIX)
                    })
                    .unwrap_or(false)
        })
        .collect();
    seals.sort();
    seals.into_iter().next()
}

/// Read a sealed directory into a [`Project`].
///
/// The fleet dir comes from the registry's own branch paths (the parent of
/// the first `branches[].path`), not from name-munging - registries are the
/// truth about their own layout. Reads as `None` when the seal is missing,
/// the registry lists no branch paths, the branches sit at the project root
/// itself (legacy flat layouts BAUD cannot card), or the fleet dir is gone
/// from disk.
fn project_from_dir(dir: &Path, anchor: bool) -> Option<Project> {
    let registry = registry_in(dir)?;
    let file_name = registry.file_name()?.to_string_lossy().into_owned();
    let name = file_name.strip_suffix(REGISTRY_SUFFIX)?.to_string();

    let raw = fs::read_to_string(&registry).ok()?;
    let document: Value = serde_json::from_str(&raw).ok()?;

    let first_branch_path = document
        .get("branches")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|branch| branch.get("path").and_then(Value::as_str))
        .map(Path::new)?;

    let fleet_relative = first_branch_path.parent()?;
    if fleet_relative.as_os_str().is_empty() {
        return None;
    }
    let fleet_dir = dir.join(fleet_relative);
    if !fleet_dir.is_dir() {
        return None;
    }

    Some(Project {
        name,
        root: dir.to_path_buf(),
        fleet_dir,
        anchor,
    })
}

/// The anchor as a project. An anchor tree whose registry is unreadable or
/// unsealed still seats - `resolve_aipass_root` already proved `src/aipass`
/// exists, so the classic layout is the honest fallback.
fn anchor_project() -> Result<Project, String> {
    let root = resolve_aipass_root()?;
    Ok(project_from_dir(&root, true).unwrap_or_else(|| Project {
        name: "AIPASS".to_string(),
        fleet_dir: join_all(&root, &FLEET_RELATIVE_DIR),
        root,
        anchor: true,
    }))
}

/// Every project BAUD can seat: the anchor, its nested `projects/*`, and its
/// sibling directories. Anchor first, the rest alphabetical; deduped on the
/// canonical root so the anchor never lists twice from the sibling scan.
fn discover_projects(anchor: &Project) -> Vec<Project> {
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    seen.insert(
        anchor
            .root
            .canonicalize()
            .unwrap_or_else(|_| anchor.root.clone()),
    );

    let mut projects = vec![anchor.clone()];
    let mut candidates: Vec<PathBuf> = Vec::new();
    for parent in [Some(anchor.root.join(PROJECTS_SUBDIR)), anchor.root.parent().map(Path::to_path_buf)]
        .into_iter()
        .flatten()
    {
        if let Ok(entries) = fs::read_dir(&parent) {
            candidates.extend(entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()));
        }
    }

    let mut found: Vec<Project> = candidates
        .into_iter()
        .filter(|dir| seen.insert(dir.canonicalize().unwrap_or_else(|_| dir.clone())))
        .filter_map(|dir| project_from_dir(&dir, false))
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    projects.extend(found);
    projects
}

/// The seated project, defaulting to the anchor. Every command that reads
/// the filesystem resolves through here.
pub(crate) fn active_project(state: &ActiveProject) -> Result<Project, String> {
    let seated = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    match seated {
        Some(project) => Ok(project),
        None => anchor_project(),
    }
}

/// A project named by the frontend, or the seated one when it names none.
///
/// The name is matched against BAUD's own census - the same door
/// [`project_switch`] uses - so a roster card can act in its own project's
/// scope without any command ever accepting a path from the webview. An
/// unknown name is an error, never a fallback to the seat: silently acting on
/// the wrong project is how an end-room kills a session nobody asked about.
pub(crate) fn project_named(
    name: Option<&str>,
    state: &ActiveProject,
) -> Result<Project, String> {
    let Some(wanted) = name else {
        return active_project(state);
    };
    let anchor = anchor_project()?;
    discover_projects(&anchor)
        .into_iter()
        .find(|project| project.name == wanted)
        .ok_or_else(|| format!("no project named '{wanted}' in BAUD's census"))
}

/// The switcher menu: every discovered project, the seated one flagged.
#[tauri::command]
fn list_projects(state: tauri::State<'_, ActiveProject>) -> Result<Vec<ProjectListing>, String> {
    let anchor = anchor_project()?;
    let active = active_project(&state)?;
    Ok(discover_projects(&anchor)
        .into_iter()
        .map(|project| ProjectListing {
            active: project.root == active.root,
            name: project.name,
            root: project.root.display().to_string(),
            anchor: project.anchor,
        })
        .collect())
}

/// Seat the fleet view in a discovered project. The name must match the
/// census exactly - there is deliberately no way to hand this command a path.
#[tauri::command]
fn project_switch(name: String, state: tauri::State<'_, ActiveProject>) -> Result<(), String> {
    let anchor = anchor_project()?;
    let project = discover_projects(&anchor)
        .into_iter()
        .find(|project| project.name == name)
        .ok_or_else(|| format!("no discovered project named '{name}'"))?;

    *state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(project);
    Ok(())
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

/// Sub-agents are invisible to the process table: they run INSIDE the parent
/// claude process, so m2.5's `/proc` scan can never see one. The truth lives
/// in the session transcript - spawning a sub-agent leaves an assistant
/// `tool_use` block (name "Agent"; "Task" in older sessions) whose
/// `tool_result` only lands when the sub-agent finishes. Unmatched spawn
/// calls = sub-agents running right now. Proven live 2026-08-10 against a
/// dispatched @hooks session: 2 unmatched calls, 2 `subagents/*.jsonl` files
/// growing beside the parent transcript.
///
/// Only sessions with recent writes are consulted (see
/// [`SUBAGENT_LIVENESS_SECS`]) - a parent BLOCKED on a synchronous sub-agent
/// writes nothing itself while the sub-agent's own file grows, so liveness
/// checks the parent's mtime AND its `<session>/subagents/` dir (the same
/// blind spot devpulse's watchdog false-fired on, 2026-08-08). A session that
/// crashed mid-spawn can overcount until the window closes behind it; the
/// window is the self-heal.
const SUBAGENT_LIVENESS_SECS: u64 = 900;
/// Spawn calls sit near the end of a live transcript: a parent waiting on
/// sub-agents appends nothing past the spawning turn, so a bounded tail read
/// is enough. A `tool_use` inside the tail always has its `tool_result` at or
/// after it, never before - the pairing cannot be split by the cut.
///
/// ASYNC agents break both assumptions (found live 2026-08-11: a 23-minute
/// sweep agent never lit the badge): their `tool_result` is a launch ack that
/// lands INSTANTLY, so the pair looks closed the whole run, and the parent
/// keeps working, so the spawn scrolls out of any tail window. Pair-matching
/// cannot see them at all. Their truth is on disk instead - see
/// [`async_agents_running`].
const SUBAGENT_TAIL_BYTES: u64 = 256 * 1024;

/// An async agent writes its own `subagents/agent-<id>.jsonl` continuously
/// while it works and goes quiet when it finishes or dies - there is no
/// persistent "done" record anywhere (the completion notification scrolls out
/// of the parent tail like everything else). A file written within this window
/// counts as running; a finished or crashed agent drops off as the window
/// closes behind it - the same self-heal-by-window doctrine as
/// [`SUBAGENT_LIVENESS_SECS`]. Sized to ride out one long model call, which
/// writes nothing until it returns.
const AGENT_FILE_ACTIVE_SECS: u64 = 180;

/// Count unmatched Agent/Task `tool_use` calls in a transcript tail.
///
/// Sidechain lines (`"isSidechain":true` - the sub-agents' own turns in older
/// transcript layouts) are skipped so a sub-agent's tool calls never inflate
/// the parent's count. Malformed lines are skipped - the first line of a tail
/// read is usually a mid-line cut.
///
/// `meta_ids` are spawns owned by [`async_agents_running`] (their
/// `agent-<id>.meta.json` names the spawning toolUseId): those are counted by
/// file freshness over there, so they are excluded here - an async spawn still
/// inside the tail must not count twice.
fn count_inflight_subagents(tail: &str, meta_ids: &std::collections::HashSet<String>) -> u64 {
    let mut spawned: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut resolved: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in tail.lines() {
        let entry: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let blocks = match entry
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
        {
            Some(blocks) => blocks,
            None => continue,
        };
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("tool_use") => {
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                    if name == "Agent" || name == "Task" {
                        if let Some(id) = block.get("id").and_then(Value::as_str) {
                            if !meta_ids.contains(id) {
                                spawned.insert(id.to_string());
                            }
                        }
                    }
                }
                Some("tool_result") => {
                    if let Some(id) = block.get("tool_use_id").and_then(Value::as_str) {
                        resolved.insert(id.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    spawned.difference(&resolved).count() as u64
}

/// Async agents running under one session, straight from disk.
///
/// Every agent spawn drops `subagents/agent-<id>.meta.json` naming its
/// `toolUseId`; the agent's own `agent-<id>.jsonl` grows beside it while it
/// works (761KB over a live 23-minute run when this was built). Running =
/// that file wrote within [`AGENT_FILE_ACTIVE_SECS`]. Returns the meta
/// toolUseIds too, so the tail counter can exclude these spawns instead of
/// counting them twice. Any read failure reads as nothing-running - same
/// fail-quiet rule as the rest of the card.
fn async_agents_running(session_dir: &Path) -> (std::collections::HashSet<String>, u64) {
    let mut meta_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut running = 0;
    let entries = match fs::read_dir(session_dir) {
        Ok(entries) => entries,
        Err(_) => return (meta_ids, 0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => continue,
        };
        let Some(stem) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".meta.json")) else {
            continue;
        };
        if let Some(id) = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|meta| meta.get("toolUseId").and_then(Value::as_str).map(String::from))
        {
            meta_ids.insert(id);
        }
        if modified_within(&session_dir.join(format!("agent-{stem}.jsonl")), AGENT_FILE_ACTIVE_SECS) {
            running += 1;
        }
    }
    (meta_ids, running)
}

/// True when the file behind `path` was modified within `window_secs`.
fn modified_within(path: &Path, window_secs: u64) -> bool {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|elapsed| elapsed.as_secs() <= window_secs)
}

/// True when any `.jsonl` directly under `dir` was modified within the window.
fn any_jsonl_modified_within(dir: &Path, window_secs: u64) -> bool {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        path.extension().is_some_and(|ext| ext == "jsonl") && modified_within(&path, window_secs)
    })
}

/// Sub-agents running under this branch's live claude session(s), summed
/// across every recently-active transcript. Any failure to look reads as 0 -
/// the card then simply shows no sub badge, which is always safe.
fn subagent_count(branch_dir: &Path) -> u64 {
    let home = match std::env::var("HOME") {
        Ok(home) if !home.trim().is_empty() => PathBuf::from(home),
        _ => return 0,
    };
    let transcripts = home
        .join(".claude")
        .join("projects")
        .join(transcript_dir_name(branch_dir));
    subagent_count_in(&transcripts)
}

fn subagent_count_in(transcripts: &Path) -> u64 {
    let entries = match fs::read_dir(transcripts) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|ext| ext == "jsonl") {
            continue;
        }
        // Liveness: the parent wrote recently, or its sub-agents did.
        let session_dir = path.with_extension("").join("subagents");
        if !modified_within(&path, SUBAGENT_LIVENESS_SECS)
            && !any_jsonl_modified_within(&session_dir, SUBAGENT_LIVENESS_SECS)
        {
            continue;
        }
        // Two species, two truths: async agents by their files growing on
        // disk, blocking agents by the unmatched spawn pair in the tail.
        let (meta_ids, running_async) = async_agents_running(&session_dir);
        count += running_async;
        count += count_inflight_subagents(&read_tail(&path, SUBAGENT_TAIL_BYTES), &meta_ids);
    }
    count
}

/// The last `max_bytes` of a file as lossy UTF-8, empty on any failure.
fn read_tail(path: &Path, max_bytes: u64) -> String {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return String::new(),
    };
    let len = match file.metadata() {
        Ok(meta) => meta.len(),
        Err(_) => return String::new(),
    };
    if len > max_bytes {
        use std::io::Seek;
        if file.seek(std::io::SeekFrom::Start(len - max_bytes)).is_err() {
            return String::new();
        }
    }
    let mut tail = Vec::with_capacity(max_bytes.min(len) as usize);
    if file.read_to_end(&mut tail).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&tail).into_owned()
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
/// seated project's root. This is the fence under every file-access command:
/// the webview can name paths, but only ones the fleet view already lives in
/// - and when the operator switches projects, the fence moves WITH the seat.
fn fenced_path_in(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|err| format!("could not canonicalize the project root: {err}"))?;
    let path = PathBuf::from(raw)
        .canonicalize()
        .map_err(|err| format!("could not resolve '{raw}': {err}"))?;
    if !path.starts_with(&root) {
        return Err(format!(
            "'{}' is outside the seated project - refusing to read it",
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
fn list_dir(path: String, state: tauri::State<'_, ActiveProject>) -> Result<Vec<DirEntryInfo>, String> {
    let dir = fenced_path_in(&active_project(&state)?.root, &path)?;
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
fn read_file_text(path: String, state: tauri::State<'_, ActiveProject>) -> Result<FileText, String> {
    let file_path = fenced_path_in(&active_project(&state)?.root, &path)?;
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
/// seated room's branch dir), then the seated project's root. First attempt
/// that canonicalizes to a regular file inside the fence wins; everything
/// else is None - the terminal only underlines what will actually open.
#[tauri::command]
fn resolve_paths(
    base: Option<String>,
    candidates: Vec<String>,
    state: tauri::State<'_, ActiveProject>,
) -> Result<Vec<Option<String>>, String> {
    let root = active_project(&state)?.root;
    Ok(resolve_paths_in(&root, base.as_deref(), &candidates))
}

fn resolve_paths_in(root: &Path, base: Option<&str>, candidates: &[String]) -> Vec<Option<String>> {
    candidates
        .iter()
        .map(|candidate| resolve_candidate(root, base, candidate))
        .collect()
}

fn resolve_candidate(root: &Path, base: Option<&str>, candidate: &str) -> Option<String> {
    let raw = Path::new(candidate);
    let attempts: Vec<PathBuf> = if raw.is_absolute() {
        vec![raw.to_path_buf()]
    } else {
        base.iter()
            .map(|dir| Path::new(dir).join(raw))
            .chain(std::iter::once(root.join(raw)))
            .collect()
    };
    attempts.into_iter().find_map(|attempt| {
        let path = fenced_path_in(root, &attempt.display().to_string()).ok()?;
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

/// Every uncommitted path in the whole repository the project root sits in.
///
/// Deliberately NOT the same question the cards ask. A card asks "what has
/// changed under me?" with `diff HEAD`, which sees tracked files only; this
/// asks "what is uncommitted in this project?", which has to include files
/// git has never seen - a brand-new module is the most interesting change in
/// the tree, and a total that hid it would read as false calm. Hence
/// `status --porcelain`, and `-uall` so an untracked DIRECTORY expands to its
/// files instead of collapsing to one line.
///
/// Ignored files stay ignored: `target/`, `node_modules/` and `dist/` never
/// reach the count. One line of porcelain is one path, renames included.
fn git_project_changes_in(dir: &Path) -> GitChanges {
    let files: Vec<String> = git_read(dir, &["status", "--porcelain", "-uall"])
        .map(|out| {
            out.lines()
                .filter(|line| !line.trim().is_empty())
                // Porcelain v1: two status columns, a space, then the path.
                .map(|line| line.get(3..).unwrap_or(line).to_owned())
                .collect()
        })
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
fn git_changes(path: String, state: tauri::State<'_, ActiveProject>) -> Result<GitChanges, String> {
    Ok(git_changes_in(&fenced_path_in(&active_project(&state)?.root, &path)?))
}

/// The seated project's whole-repo uncommitted count, for the header total.
///
/// Takes no path on purpose: the frontend cannot aim this at a directory, so
/// the read stays pinned to whatever project the operator is seated in.
#[tauri::command]
fn git_project_changes(state: tauri::State<'_, ActiveProject>) -> Result<GitChanges, String> {
    Ok(git_project_changes_in(&active_project(&state)?.root))
}

/// The diff behind the badge, for the changes tab. Fenced, read-only.
#[tauri::command]
fn git_diff_text(path: String, state: tauri::State<'_, ActiveProject>) -> Result<FileText, String> {
    git_diff_in(&fenced_path_in(&active_project(&state)?.root, &path)?)
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
///
/// `scope` is the seated project's mark for non-anchor projects (m7): scoped
/// rooms (`baud-vera-studio-vera`) keep two projects' same-named branches
/// out of each other's sessions, while anchor rooms keep the plain
/// `baud-<branch>` names that predate the switcher.
pub fn room_name(scope: Option<&str>, branch_name: &str) -> String {
    let sanitize = |text: &str| -> String {
        text.chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                    ch
                } else {
                    '-'
                }
            })
            .collect()
    };
    match scope {
        Some(project) => format!("{ROOM_PREFIX}{}-{}", sanitize(project), sanitize(branch_name)),
        None => format!("{ROOM_PREFIX}{}", sanitize(branch_name)),
    }
}

/// The command name tmux reports for a pane running a claude session. An
/// install that shows up as something else (a node shim, a wrapper script)
/// simply never matches - that costs a card its outside-room tag, which is
/// the same place we stood before m12. A LOOSER test would be worse: BAUD
/// would treat the operator's own shell session as an agent's room and type
/// into it.
const CLAUDE_PANE_COMMAND: &str = "claude";

/// What one tmux round-trip tells the snapshot.
#[derive(Debug, Default)]
struct RoomScan {
    /// Every live session name on the server.
    names: std::collections::HashSet<String>,
    /// `(session name, pane cwd)` for every pane running a claude, in the
    /// order tmux listed them.
    agent_panes: Vec<(String, PathBuf)>,
}

impl RoomScan {
    /// The session holding a claude seated in `dir`, ignoring BAUD's own
    /// rooms - those belong to a card already, and a `baud-` room whose name
    /// does not match this branch is not this branch's business. Ties break
    /// on the session name so two candidates always resolve the same way.
    fn agent_session_in(&self, dir: &Path) -> Option<String> {
        let mut found: Vec<&String> = self
            .agent_panes
            .iter()
            .filter(|(name, cwd)| !name.starts_with(ROOM_PREFIX) && cwd.starts_with(dir))
            .map(|(name, _)| name)
            .collect();
        found.sort();
        found.first().map(|name| (*name).clone())
    }

    /// Every session whose claude pane holds an INTERACTIVE claude, sorted and
    /// deduplicated. BAUD's own rooms are included here - unlike
    /// [`Self::agent_session_in`], which answers "whose room is this?" and so
    /// must skip them, this answers "is anyone home in that session?".
    ///
    /// The pane command alone cannot tell an interactive claude from a
    /// dispatched headless one - both are literally `claude` - so the process
    /// table decides, matching a pane to a session by directory the same way
    /// a card's `interactive` figure does.
    fn live_agent_sessions(&self, sessions: &[ClaudeSession]) -> Vec<String> {
        let mut found: Vec<String> = self
            .agent_panes
            .iter()
            .filter(|(_, pane_cwd)| {
                // /proc reports kernel-canonical cwds; tmux does not, so
                // canonicalize the pane's before comparing (a symlinked tree
                // otherwise never matches).
                let pane = pane_cwd.canonicalize().unwrap_or_else(|_| pane_cwd.clone());
                sessions
                    .iter()
                    .any(|session| !session.headless && session.cwd.starts_with(&pane))
            })
            .map(|(name, _)| name.clone())
            .collect();
        found.sort();
        found.dedup();
        found
    }
}

/// Every live tmux session, and where its claude panes are sitting. No server
/// (or no tmux) reads as no rooms - same quiet doctrine as the mailbox and
/// the git figure.
///
/// One `list-panes -a` replaces the old `list-sessions`: every session has at
/// least one pane, so the names are all still here, and the panes are what
/// tell an agent's session from a plain shell (m12).
fn scan_rooms() -> RoomScan {
    let output = Command::new("tmux")
        .args([
            "list-panes",
            "-a",
            "-F",
            "#{session_name}\t#{pane_current_command}\t#{pane_current_path}",
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => parse_panes(&String::from_utf8_lossy(&out.stdout)),
        _ => RoomScan::default(),
    }
}

/// Turn `list-panes` output into a [`RoomScan`]. Split out so the shape tmux
/// hands us is testable without a tmux server.
fn parse_panes(text: &str) -> RoomScan {
    let mut scan = RoomScan::default();
    for line in text.lines() {
        let mut fields = line.split('\t');
        let (Some(name), Some(command), Some(path)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        scan.names.insert(name.to_string());
        if command.trim() == CLAUDE_PANE_COMMAND && !path.trim().is_empty() {
            scan.agent_panes
                .push((name.to_string(), PathBuf::from(path.trim())));
        }
    }
    scan
}

/// The live tmux session a branch's doors act on: BAUD's own room when it
/// exists, otherwise the outside session holding this branch's claude (m12).
/// `None` means nothing is running for this branch - a launch would create
/// the room, an end has nothing to do.
pub(crate) fn branch_session(project: &Project, branch_name: &str) -> Option<String> {
    let own = room_name(project.room_scope().as_deref(), branch_name);
    let scan = scan_rooms();
    if scan.names.contains(&own) {
        return Some(own);
    }
    // The branch dir is derived HERE, from the seated project - the frontend
    // names a branch, never a path. A name that is not a single directory
    // component is refused rather than resolved.
    if branch_name.is_empty() || branch_name.contains(['/', '\\']) || branch_name.starts_with('.') {
        return None;
    }
    let canonical = project.fleet_dir.join(branch_name).canonicalize().ok()?;
    scan.agent_session_in(&canonical)
}

/// End a branch's session for real - the ONE door that ends one (Patrick
/// ruling 2026-08-10: detach everywhere else). Killing a room that is already
/// gone is the goal state, not an error. Since m12 this reaches the outside
/// session too when the branch has no room of its own: the agent the card
/// shows alive is the agent this button ends, or the operator cannot end it
/// at all (Patrick-caught 2026-08-12, `aipass-aipass`).
#[tauri::command]
fn room_kill(
    branch_name: String,
    project: Option<String>,
    state: tauri::State<'_, ActiveProject>,
) -> Result<(), String> {
    // The room this ends belongs to the card that was clicked, not to the
    // seat: a roster attach can leave the terminal holding another project's
    // room, and resolving the name here under the seated scope would end a
    // session the operator never named.
    let project = project_named(project.as_deref(), &state)?;
    end_room_in(&project, &branch_name).map(|_| ())
}

/// What ending a room actually did, for a caller that has to say so.
///
/// The desktop throws this away - a card that stops being green has already
/// told the operator. A phone six rooms away has nothing else to go on, so the
/// distinction between "ended it" and "there was nothing to end" is carried
/// rather than flattened into a bare Ok.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RoomEnded {
    /// The tmux session that was ended, or `None` when nothing was live.
    pub room: Option<String>,
}

/// End a branch's session inside an ALREADY-RESOLVED project.
///
/// The project arrives as an argument rather than being looked up, which is
/// what lets the headless seam and the desktop command share one body: the
/// desktop resolves from its seat, the seam from the census, and neither owns
/// a second way to end a session. Same shape - and the same reason - as
/// [`select_project`] taking its anchor in.
///
/// The name fence is HERE rather than at either caller, because a fence that
/// each door has to remember is a fence one of them eventually forgets.
pub(crate) fn end_room_in(project: &Project, branch_name: &str) -> Result<RoomEnded, String> {
    match resolve_room(project, branch_name)? {
        Some(session) => {
            room_kill_named(&session)?;
            Ok(RoomEnded {
                room: Some(session),
            })
        }
        // Nothing live for this branch: already the goal state.
        None => Ok(RoomEnded { room: None }),
    }
}

/// The live room a headless door acts on, or `None` when the branch is real
/// and simply has nothing running.
///
/// Every door that names a branch comes through here, so the fence is written
/// once. A fence each door has to remember is one a door eventually forgets -
/// and the doors now number four.
pub(crate) fn resolve_room(project: &Project, branch_name: &str) -> Result<Option<String>, String> {
    if branch_name.is_empty() {
        return Err("a branch name is required".to_string());
    }
    // NAMES, not paths - the same rule the read lane is fenced on. Refusing is
    // the whole point: a name that resolves anywhere but one directory under
    // this project's fleet dir must not reach tmux at all.
    if branch_name.contains(['/', '\\']) || branch_name.starts_with('.') {
        return Err(format!(
            "branch name '{branch_name}' is not a single directory component - this door takes names, not paths"
        ));
    }
    // An unknown branch is refused, never treated as "nothing here". The two
    // look identical in a `null` room and are opposite facts: one means the
    // caller is holding a stale or wrong name, the other means the goal state
    // is already reached. Same doctrine as an unknown project name.
    if !project.fleet_dir.join(branch_name).is_dir() {
        return Err(format!(
            "no branch named '{branch_name}' in project '{}'",
            project.name
        ));
    }
    Ok(branch_session(project, branch_name))
}

/// The room a terminal door needs: like [`resolve_room`], but a branch with
/// nothing running is a REFUSAL rather than a quiet `None`.
///
/// The kill can treat a dead room as the goal state. Capture and send cannot:
/// there is no screen to show and nothing to type into, and rendering an empty
/// pane would look exactly like an agent sitting at a blank prompt.
fn live_room_in(project: &Project, branch_name: &str) -> Result<String, String> {
    resolve_room(project, branch_name)?
        .ok_or_else(|| format!("no room live for '{branch_name}' - nothing to attach to"))
}

/// The keystroke names `--key` will pass to tmux, and the only ones.
///
/// `send-keys` WITHOUT `-l` interprets its argument, so an unbounded name is an
/// unbounded keystroke. This list is the contract's, exactly - the six the key
/// bar shows plus the ones a stuck agent needs.
const ALLOWED_KEYS: [&str; 14] = [
    "Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "C-c", "C-d", "C-l", "C-u", "BSpace",
    "PageUp", "PageDown",
];

/// Longest literal `--text` will type in one call. Refused rather than
/// trimmed: a caller whose 3000 characters silently became 2000 would believe
/// they had typed a command they did not type.
const TEXT_LIMIT: usize = 2000;

/// Deepest scrollback `--capture-room` will reach above the visible screen.
const LINES_LIMIT: i64 = 2000;

fn key_is_allowed(name: &str) -> bool {
    ALLOWED_KEYS.contains(&name)
}

fn refuse_lines(lines: i64) -> Result<(), String> {
    if !(0..=LINES_LIMIT).contains(&lines) {
        return Err(format!(
            "--lines is {lines}, outside the 0 to {LINES_LIMIT} this door will read - refused rather than clamped, because a caller who asked for 5000 and silently got 2000 would believe they had the whole history"
        ));
    }
    Ok(())
}

fn refuse_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("--text needs something to type".to_string());
    }
    if text.chars().count() > TEXT_LIMIT {
        return Err(format!(
            "--text is {} characters, over the {TEXT_LIMIT} limit - refused rather than trimmed, because half a command is worse than none",
            text.chars().count()
        ));
    }
    Ok(())
}

/// What `--send-room` was asked to put into the room. The two are different
/// mechanisms, not two spellings of one: a literal is TYPED, a key name is
/// INTERPRETED.
///
/// PARKED, AND NOT THE INPUT PATH (@devpulse ruling, 2026-08-14). `--send-room`
/// is **not** how the phone types into a room and **not** a general input door:
/// the attach PTY behind `/v1/room/attach` is the one door for input, and this
/// flag is routed to by nothing. It stays because deleting working tested code
/// on a late ruling is worse than parking it - but parked has to be WRITTEN
/// DOWN, or unused-but-shipped quietly becomes the second door the one-door
/// principle exists to prevent. Revisited at reconciliation.
///
/// Its sibling `--capture-room` is parked on stronger ground: looking is a
/// read and typing is a verb, and attach is operate-only by nature (a shell
/// prompt has no reading half), so a capture is the only path there will ever
/// be to a look-don't-touch view under a read token.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SendPayload {
    /// Typed verbatim through `send-keys -l`. Never interpreted: a literal
    /// `C-c` in here types those four characters.
    Text(String),
    /// One allowlisted name through `send-keys`, interpreted as a keystroke.
    Key(String),
}

/// The tmux target for a room's SCREEN, which is not the target for its
/// session.
///
/// `kill-session -t =room` names a session; `capture-pane`/`send-keys` want a
/// PANE, and a bare session name is not one - tmux answers "can't find pane"
/// (found live, first capture attempt). The trailing colon makes it
/// `session:current-window.active-pane`, and the `=` still forces an exact
/// name match so a room called `baud-api` can never resolve to `baud-api-2`.
fn pane_target(room: &str) -> String {
    format!("={room}:")
}

/// The argv for one capture. Split out so the shape tmux is handed can be
/// asserted without a tmux server - the same reason `parse_panes` exists.
fn capture_args(target: &str, lines: i64) -> Vec<String> {
    let mut argv = vec![
        "capture-pane".to_string(),
        "-p".to_string(),
        // Escape sequences PRESERVED - the phone renders the colours the desk
        // sees. A monochrome mirror of a coloured screen is a different screen.
        "-e".to_string(),
        "-t".to_string(),
        target.to_string(),
    ];
    if lines > 0 {
        argv.push("-S".to_string());
        argv.push(format!("-{lines}"));
    }
    argv
}

/// The argv for one send. The `-l` is the whole difference between typing and
/// pressing, so the two payloads produce visibly different lines.
fn send_keys_args(target: &str, payload: &SendPayload) -> Vec<String> {
    let mut argv = vec!["send-keys".to_string(), "-t".to_string(), target.to_string()];
    match payload {
        SendPayload::Text(text) => {
            argv.push("-l".to_string());
            // `--` so a literal beginning with a dash is typed rather than
            // read as a tmux flag.
            argv.push("--".to_string());
            argv.push(text.clone());
        }
        SendPayload::Key(name) => argv.push(name.clone()),
    }
    argv
}

fn room_kill_named(room: &str) -> Result<(), String> {
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

/// What one room's screen looks like right now, inside an already-resolved
/// project.
///
/// Read-only in the strictest sense: `capture-pane` observes, it does not
/// attach, so nothing about the operator's own view changes - no resize, no
/// focus, no client. The phone renders at the captured geometry and scrolls,
/// which is a stated limit rather than an oversight: resizing the room from a
/// pocket would scramble whatever is on the desk mid-session.
pub(crate) fn capture_room_in(
    project: &Project,
    branch_name: &str,
    lines: i64,
) -> Result<PaneCapture, String> {
    refuse_lines(lines)?;
    let room = live_room_in(project, branch_name)?;
    let target = pane_target(&room);

    let output = Command::new("tmux")
        .args(capture_args(&target, lines))
        .output()
        .map_err(|err| format!("could not run tmux: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "could not capture '{room}': {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let pane = String::from_utf8_lossy(&output.stdout).to_string();

    // Geometry is a separate question from content, and a failure to answer it
    // must not lose the screen we already hold: zeroes mean "tmux would not
    // say", and the phone falls back to its own default.
    let (cols, rows) = pane_geometry(&target);

    Ok(PaneCapture {
        room,
        pane,
        cols,
        rows,
    })
}

/// One room's pane geometry, or `(0, 0)` when tmux will not say.
fn pane_geometry(target: &str) -> (u16, u16) {
    let output = Command::new("tmux")
        .args(["display-message", "-p", "-t", target, "#{pane_width}\t#{pane_height}"])
        .output();
    let Ok(output) = output else { return (0, 0) };
    if !output.status.success() {
        return (0, 0);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut fields = text.trim().split('\t');
    let cols = fields.next().and_then(|f| f.parse().ok()).unwrap_or(0);
    let rows = fields.next().and_then(|f| f.parse().ok()).unwrap_or(0);
    (cols, rows)
}

/// One room's screen, as read.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PaneCapture {
    pub room: String,
    pub pane: String,
    pub cols: u16,
    pub rows: u16,
}

/// Put one payload into one room, inside an already-resolved project.
///
/// TEXT IS TYPED, NEVER RUN. `send-keys -l` inserts the characters and nothing
/// else - this door cannot append a newline, so a paste alone can never
/// execute. Submitting stays a separate, deliberate act, which is BAUD's own
/// rule carried out of `Terminal.tsx` rather than a new one invented for the
/// wire.
pub(crate) fn send_room_in(
    project: &Project,
    branch_name: &str,
    payload: &SendPayload,
) -> Result<String, String> {
    match payload {
        SendPayload::Text(text) => refuse_text(text)?,
        // Checked here as well as at the parse: this function is reachable
        // from the desktop side of the crate too, and the allowlist IS the
        // safety of the interpreted path.
        SendPayload::Key(name) if !key_is_allowed(name) => {
            return Err(format!(
                "'{name}' is not one of the keys this door will press ({})",
                ALLOWED_KEYS.join(", ")
            ))
        }
        SendPayload::Key(_) => {}
    }

    let room = live_room_in(project, branch_name)?;
    let target = pane_target(&room);
    let output = Command::new("tmux")
        .args(send_keys_args(&target, payload))
        .output()
        .map_err(|err| format!("could not run tmux: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "could not send to '{room}': {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(room)
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

/// What class does this branch's passport declare its citizen to be?
///
/// The passport's `identity.citizen_class`, VERBATIM and unjudged - spawn's
/// identity-only field, never minted from a template, so a passport either
/// says a class or the branch has none to report. Every failure path (no
/// passport, unreadable, malformed, key absent) reads as the empty string: a
/// class is a claim the FILE makes, and BAUD repeats it rather than inventing
/// one. Nothing here knows which classes exist, which is the point - the value
/// travels to the passport view unchanged and a class AIPass adds later
/// arrives without touching this function.
fn citizen_class_of(branch_dir: &Path) -> String {
    let raw = match fs::read_to_string(join_all(branch_dir, &PASSPORT_RELATIVE_PATH)) {
        Ok(contents) => contents,
        Err(_) => return String::new(),
    };
    let document: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return String::new(),
    };
    document
        .get("identity")
        .and_then(|identity| identity.get("citizen_class"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
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
    project: &str,
    sessions: &[ClaudeSession],
    rooms: &RoomScan,
    room_scope: Option<&str>,
) -> BranchStatus {
    let mut status =
        BranchStatus::new(name, project.to_owned(), branch_dir.display().to_string());
    status.is_citizen = join_all(branch_dir, &PASSPORT_RELATIVE_PATH).is_file();
    // One read, both answers - and `manager` stays derived from the class
    // rather than sampled separately, so the two can never disagree.
    status.citizen_class = if status.is_citizen {
        citizen_class_of(branch_dir)
    } else {
        String::new()
    };
    status.manager = status.citizen_class == "manager";
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
    status.subagents = subagent_count(&canonical);

    // Named once and used twice: the badge asks whether this session exists,
    // the row carries the name either way. Deriving it a second time here is
    // exactly the duplication this field exists to retire upstream.
    status.room = room_name(room_scope, &status.name);
    status.has_room = rooms.names.contains(&status.room);
    // Only when BAUD has no room here: a card with its own room already knows
    // which session its doors act on, and that one wins (m12).
    status.outside_room = if status.has_room {
        None
    } else {
        rooms.agent_session_in(&canonical)
    };

    apply_dashboard(branch_dir, &mut status);
    let (new_mail, opened_mail) = mail_counts_in(branch_dir);
    status.new_mail = new_mail;
    status.opened_mail = opened_mail;
    status
}

/// Scan the seated project's fleet dir - visible directories only. Returns the
/// cards plus the machine-wide list of sessions holding a live interactive
/// claude, which is read off the same two scans rather than costing a third.
fn scan_fleet(project: &Project) -> Result<(Vec<BranchStatus>, Vec<String>), String> {
    // One process-table pass and one tmux round-trip shared by every branch.
    let sessions = scan_claude_sessions();
    let rooms = scan_rooms();
    let branches = branches_of(project, &sessions, &rooms)?;
    let live_sessions = rooms.live_agent_sessions(&sessions);
    Ok((branches, live_sessions))
}

/// One project's cards, off scans the caller already paid for. Split out so
/// the roster can sweep every project without re-reading `/proc` and re-asking
/// tmux once per project.
fn branches_of(
    project: &Project,
    sessions: &[ClaudeSession],
    rooms: &RoomScan,
) -> Result<Vec<BranchStatus>, String> {
    let fleet_dir = &project.fleet_dir;
    let room_scope = project.room_scope();

    let entries = fs::read_dir(fleet_dir)
        .map_err(|err| format!("could not read '{}': {err}", fleet_dir.display()))?;

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

        branches.push(read_branch(
            &entry.path(),
            name,
            &project.name,
            sessions,
            rooms,
            room_scope.as_deref(),
        ));
    }

    branches.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(branches)
}

/// Every working agent BAUD can see, across every project in its census.
///
/// The roster tabs' one command, and the answer to a real operator problem:
/// two managers in two projects, one seat, and the project chip in between.
/// Working means a live interactive claude or a dispatch in flight - an idle
/// room is a place, not an agent at work, and listing it would bury the two
/// cards that matter under sixteen that do not.
///
/// Read-only and path-free like [`fleet_snapshot`]: it takes no arguments at
/// all and sweeps only projects the backend discovered itself. One `/proc`
/// pass and one tmux round-trip serve every project, so the sweep costs the
/// same two syscall storms a single snapshot already pays.
#[tauri::command]
fn agent_roster() -> Result<Vec<BranchStatus>, String> {
    let anchor = anchor_project()?;
    let sessions = scan_claude_sessions();
    let rooms = scan_rooms();

    let mut working: Vec<BranchStatus> = discover_projects(&anchor)
        .iter()
        // A project whose fleet dir has gone missing is skipped, never fatal:
        // one bad tree must not empty the roster of every other project.
        .filter_map(|project| branches_of(project, &sessions, &rooms).ok())
        .flatten()
        .filter(|branch| branch.is_citizen && (branch.interactive || branch.dispatched))
        .collect();

    // Dispatched first, then live, then by project so a manager's own agents
    // read together - the same ranking the strip uses, one level wider.
    working.sort_by(|a, b| {
        let rank = |branch: &BranchStatus| if branch.dispatched { 0 } else { 1 };
        rank(a)
            .cmp(&rank(b))
            .then_with(|| a.project.cmp(&b.project))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(working)
}

/// The fleet view's one command. Read-only by construction: it takes no
/// path arguments, so the frontend cannot steer where it reads - it can only
/// pick a seat from the backend's own census via [`project_switch`].
#[tauri::command]
fn fleet_snapshot(state: tauri::State<'_, ActiveProject>) -> FleetSnapshot {
    let project = match active_project(&state) {
        Ok(project) => project,
        Err(error) => return FleetSnapshot::failed(error),
    };

    let (name, root_display) = (project.name.clone(), project.root.display().to_string());

    match scan_fleet(&project) {
        Ok((branches, live_agent_sessions)) => FleetSnapshot {
            project: name,
            root: root_display,
            generated_at: now_iso8601(),
            error: None,
            branches,
            live_agent_sessions,
        },
        Err(error) => FleetSnapshot {
            project: name,
            root: root_display,
            generated_at: now_iso8601(),
            error: Some(error),
            branches: Vec::new(),
            live_agent_sessions: Vec::new(),
        },
    }
}

/// What the command line asked this process to be.
#[derive(Debug, Clone, PartialEq)]
enum Invocation {
    /// No headless flag - open the window, which is what BAUD normally is.
    Window,
    /// `--snapshot [--project <name>]` - print one fleet read and exit.
    Snapshot { project: Option<String> },
    /// `--end-room <branch> [--project <name>]` - end one room and exit.
    EndRoom {
        branch: String,
        project: Option<String>,
    },
    /// `--capture-room <branch> [--project <name>] [--lines <N>]` - read one
    /// room's screen and exit.
    CaptureRoom {
        branch: String,
        project: Option<String>,
        lines: i64,
    },
    /// `--send-room <branch> [--project <name>] (--text <s> | --key <NAME>)` -
    /// put one payload into one room and exit.
    SendRoom {
        branch: String,
        project: Option<String>,
        payload: SendPayload,
    },
    /// `--list-projects` - print the switcher's census and exit. Takes no
    /// `--project`: the census IS the set of valid project names, so there is
    /// nothing to scope it by.
    ListProjects,
    /// `--roster` - print every project's WORKING agents and exit. Takes no
    /// `--project` either, and for a sharper reason: crossing projects is the
    /// entire point, so a scoped roster is a fleet read with extra steps.
    Roster,
    /// Called wrong STRUCTURALLY - a flag missing its value, two verbs, a
    /// branch not named. Exit 2, stdout empty.
    ///
    /// Deliberately NOT where a bad *value* lands. A key name that is not on
    /// the allowlist, or a scrollback depth over the cap, is the CALLER's data
    /// arriving through a correctly-built command line - so those refuse with
    /// a full envelope and exit 1, and the sentence reaches the operator's
    /// screen instead of becoming "the invoker built a bad line".
    Usage(String),
}

/// The headless verbs. A process that carries one of these has been asked for
/// an answer, not a window.
const HEADLESS_FLAGS: [&str; 6] = [
    "--snapshot",
    "--end-room",
    "--capture-room",
    "--send-room",
    "--list-projects",
    "--roster",
];

/// Parse the process arguments (already stripped of argv0).
///
/// Only a HEADLESS_FLAG opts into headless mode; anything else falls through to
/// the window untouched, because `tauri dev` passes arguments of its own and a
/// strict parser here would refuse to start the app. Once one IS present the
/// parse turns strict: a misspelled flag then means the caller wanted data and
/// would otherwise get a GUI, or worse, silently get a different project than
/// they asked for.
///
/// Two verbs in one command line is a usage error rather than a precedence
/// rule. One process, one answer - a caller who wrote both does not know what
/// they asked for, and guessing for them is how a read turns into a kill.
fn parse_invocation(args: &[String]) -> Invocation {
    let verbs: Vec<&String> = args
        .iter()
        .filter(|arg| HEADLESS_FLAGS.contains(&arg.as_str()))
        .collect();
    let verb = match verbs.as_slice() {
        [] => return Invocation::Window,
        [only] => only.as_str(),
        _ => return Invocation::Usage("one headless verb at a time".to_string()),
    };

    // Every verb but --snapshot names a branch, positionally, so the flag
    // reads like the button it stands for: `baud --end-room devpulse`.
    let takes_branch = !matches!(verb, "--snapshot" | "--list-projects" | "--roster");

    let mut project = None;
    let mut branch = None;
    let mut lines = 0_i64;
    let mut text = None;
    let mut key = None;
    let mut rest = args.iter().filter(|arg| arg.as_str() != verb);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            // The census-shaped verbs refuse the flag rather than ignoring it:
            // neither can be scoped, and a silently dropped argument reads as a
            // filter that worked.
            "--project" if !matches!(verb, "--list-projects" | "--roster") => match rest.next() {
                Some(name) if !name.starts_with("--") => project = Some(name.clone()),
                _ => return Invocation::Usage("--project needs a project name".to_string()),
            },
            // Only the SHAPE is checked here - "is this a number at all".
            // Whether the number is in range is a value question, and value
            // questions answer with an envelope; see `refuse_lines`.
            "--lines" if verb == "--capture-room" => match rest.next().map(|n| n.parse::<i64>()) {
                Some(Ok(depth)) => lines = depth,
                _ => return Invocation::Usage("--lines needs a whole number".to_string()),
            },
            // A literal may legitimately begin with a dash, so `--text` takes
            // WHATEVER follows it. Refusing `--text --help` would make that
            // string impossible to type from a phone.
            "--text" if verb == "--send-room" => match rest.next() {
                Some(literal) => text = Some(literal.clone()),
                None => return Invocation::Usage("--text needs something to type".to_string()),
            },
            "--key" if verb == "--send-room" => match rest.next() {
                Some(name) => key = Some(name.clone()),
                None => return Invocation::Usage("--key needs a key name".to_string()),
            },
            other if takes_branch && !other.starts_with("--") && branch.is_none() => {
                branch = Some(other.to_string());
            }
            other => return Invocation::Usage(format!("unknown argument '{other}'")),
        }
    }

    if takes_branch && branch.is_none() {
        return Invocation::Usage(format!("{verb} needs a branch name"));
    }
    let branch = branch.unwrap_or_default();

    match verb {
        "--end-room" => Invocation::EndRoom { branch, project },
        "--capture-room" => Invocation::CaptureRoom {
            branch,
            project,
            lines,
        },
        "--send-room" => match (text, key) {
            // Exactly one. The two are different mechanisms - typed versus
            // interpreted - and guessing which a caller meant is how a paste
            // turns into a control code.
            (Some(literal), None) => Invocation::SendRoom {
                branch,
                project,
                payload: SendPayload::Text(literal),
            },
            (None, Some(name)) => Invocation::SendRoom {
                branch,
                project,
                payload: SendPayload::Key(name),
            },
            (Some(_), Some(_)) => {
                Invocation::Usage("--text and --key are alternatives, not a pair".to_string())
            }
            (None, None) => {
                Invocation::Usage("--send-room needs one of --text or --key".to_string())
            }
        },
        "--list-projects" => Invocation::ListProjects,
        "--roster" => Invocation::Roster,
        _ => Invocation::Snapshot { project },
    }
}

/// The project a headless snapshot reads: the named one, or the anchor when
/// none is named. The window's own default is the SEATED project, which does
/// not exist out here - there is no seat in a process with no window - so the
/// anchor stands in, and `--project` is how a caller asks for any other.
///
/// An unknown name is an error and never a fallback: handing back the anchor's
/// fleet to a caller who asked for a different project is exactly the silent
/// wrong answer that makes a remote `kill` dangerous.
fn snapshot_project(name: Option<&str>) -> Result<Project, String> {
    select_project(anchor_project()?, name)
}

/// The census half of [`snapshot_project`], split out because it takes the
/// anchor as an argument instead of resolving one.
///
/// That split is the whole CI story: a test can hand this a fixture tree it
/// built itself, while a test aimed at `snapshot_project` can only ever reach
/// the real AIPass root - green on this machine, red on a bare runner. Same
/// lesson as the `resolve_paths` fix in 0d88bc5, same remedy.
fn select_project(anchor: Project, name: Option<&str>) -> Result<Project, String> {
    let Some(wanted) = name else {
        return Ok(anchor);
    };
    discover_projects(&anchor)
        .into_iter()
        .find(|project| project.name == wanted)
        .ok_or_else(|| format!("no project named '{wanted}' in BAUD's census"))
}

/// One fleet read, with no tauri state anywhere in reach.
///
/// This is the whole point of the flag: the desktop app and @api's host API
/// call the SAME `scan_fleet`, so "which agents are alive" has exactly one
/// implementation. A second one in Python would drift, and the day it drifted
/// neither answer would be trusted.
fn snapshot_headless(name: Option<&str>) -> FleetSnapshot {
    let project = match snapshot_project(name) {
        Ok(project) => project,
        Err(error) => return FleetSnapshot::failed(error),
    };
    let (project_name, root_display) = (project.name.clone(), project.root.display().to_string());

    match scan_fleet(&project) {
        Ok((branches, live_agent_sessions)) => FleetSnapshot {
            project: project_name,
            root: root_display,
            generated_at: now_iso8601(),
            error: None,
            branches,
            live_agent_sessions,
        },
        Err(error) => FleetSnapshot {
            project: project_name,
            root: root_display,
            generated_at: now_iso8601(),
            error: Some(error),
            branches: Vec::new(),
            live_agent_sessions: Vec::new(),
        },
    }
}

/// Exit code for a finished snapshot: 0 when it is a real read, 1 when the
/// payload carries an error instead. stdout is valid JSON either way, so a
/// caller may parse unconditionally and use the code as the cheap check.
fn snapshot_exit_code(snapshot: &FleetSnapshot) -> i32 {
    i32::from(snapshot.error.is_some())
}

/// One headless room kill, as JSON on stdout.
///
/// `detail` and `error` are mutually exclusive by construction: exactly one is
/// non-null, and which one it is matches the exit code. A caller that only
/// reads one field can still never be misled about whether it worked.
#[derive(Debug, Clone, Serialize)]
pub struct KillOutcome {
    /// The project the branch was resolved in - the caller's name echoed back
    /// only once it has been proved to exist, or "?" when it never resolved.
    pub project: String,
    /// The branch the caller named, echoed verbatim.
    pub branch: String,
    /// The tmux session that was ended, or null when nothing was live.
    pub room: Option<String>,
    /// True ONLY when this call ended a live session. False with no error
    /// means there was nothing to end - a success, and a different fact.
    pub ended: bool,
    /// The sentence to show an operator, on success. Null on failure.
    pub detail: Option<String>,
    /// ISO-8601 UTC timestamp of this call.
    pub generated_at: String,
    /// The sentence to show an operator, on failure. Null on success.
    pub error: Option<String>,
}

impl KillOutcome {
    /// Nothing happened and here is why - the shape every refusal takes.
    fn failed(branch: &str, project: Option<&str>, error: String) -> Self {
        KillOutcome {
            project: project.unwrap_or("?").to_string(),
            branch: branch.to_string(),
            room: None,
            ended: false,
            detail: None,
            generated_at: now_iso8601(),
            error: Some(error),
        }
    }
}

/// End one named room in one named project, with no tauri state in reach.
///
/// The gate @api's `/v1/verbs/kill` is waiting on. It reaches the SAME
/// `end_room_in` the desktop button reaches, which reaches the same
/// `room_kill_named` - so `room_kill` stays the one thing that ends a session
/// and this flag is a door onto it, never a second mechanism. There is no
/// `tmux kill-session` anywhere in the headless path.
fn end_room_headless(branch: &str, project_name: Option<&str>) -> KillOutcome {
    let project = match snapshot_project(project_name) {
        Ok(project) => project,
        Err(error) => return KillOutcome::failed(branch, project_name, error),
    };

    match end_room_in(&project, branch) {
        Ok(RoomEnded { room: Some(room) }) => KillOutcome {
            project: project.name,
            branch: branch.to_string(),
            detail: Some(format!("ended '{room}'")),
            room: Some(room),
            ended: true,
            generated_at: now_iso8601(),
            error: None,
        },
        Ok(RoomEnded { room: None }) => KillOutcome {
            project: project.name,
            branch: branch.to_string(),
            room: None,
            ended: false,
            detail: Some(format!("nothing live for '{branch}' - already ended")),
            generated_at: now_iso8601(),
            error: None,
        },
        Err(error) => KillOutcome::failed(branch, Some(&project.name), error),
    }
}

/// Exit code for a finished kill: 0 when it did what was asked - including the
/// idempotent nothing-to-end - and 1 when it refused. Same contract as the
/// snapshot, deliberately: @api parses one envelope shape and one code rule.
fn kill_exit_code(outcome: &KillOutcome) -> i32 {
    i32::from(outcome.error.is_some())
}

/// One room's screen, as JSON on stdout.
///
/// Same envelope promise as [`KillOutcome`]: `detail` and `error` are mutually
/// exclusive, and which one is set matches the exit code.
#[derive(Debug, Clone, Serialize)]
pub struct CaptureOutcome {
    pub project: String,
    pub branch: String,
    /// The room that was read, or null when nothing was.
    pub room: Option<String>,
    /// The screen itself, escape sequences intact. Empty string on a refusal -
    /// never null, so a renderer has one type to handle.
    pub pane: String,
    /// Pane geometry as tmux reported it; 0 when it would not say.
    pub cols: u16,
    pub rows: u16,
    /// True only when a real screen was read.
    pub captured: bool,
    pub detail: Option<String>,
    pub generated_at: String,
    pub error: Option<String>,
}

impl CaptureOutcome {
    fn failed(branch: &str, project: Option<&str>, error: String) -> Self {
        CaptureOutcome {
            project: project.unwrap_or("?").to_string(),
            branch: branch.to_string(),
            room: None,
            pane: String::new(),
            cols: 0,
            rows: 0,
            captured: false,
            detail: None,
            generated_at: now_iso8601(),
            error: Some(error),
        }
    }
}

/// One send, as JSON on stdout.
#[derive(Debug, Clone, Serialize)]
pub struct SendOutcome {
    pub project: String,
    pub branch: String,
    pub room: Option<String>,
    /// True only when tmux accepted the payload.
    pub sent: bool,
    pub detail: Option<String>,
    pub generated_at: String,
    pub error: Option<String>,
}

impl SendOutcome {
    fn failed(branch: &str, project: Option<&str>, error: String) -> Self {
        SendOutcome {
            project: project.unwrap_or("?").to_string(),
            branch: branch.to_string(),
            room: None,
            sent: false,
            detail: None,
            generated_at: now_iso8601(),
            error: Some(error),
        }
    }
}

/// Read one room's screen with no tauri state in reach.
fn capture_room_headless(branch: &str, project_name: Option<&str>, lines: i64) -> CaptureOutcome {
    let project = match snapshot_project(project_name) {
        Ok(project) => project,
        Err(error) => return CaptureOutcome::failed(branch, project_name, error),
    };
    match capture_room_in(&project, branch, lines) {
        Ok(capture) => CaptureOutcome {
            project: project.name,
            branch: branch.to_string(),
            detail: Some(format!("read '{}'", capture.room)),
            room: Some(capture.room),
            pane: capture.pane,
            cols: capture.cols,
            rows: capture.rows,
            captured: true,
            generated_at: now_iso8601(),
            error: None,
        },
        Err(error) => CaptureOutcome::failed(branch, Some(&project.name), error),
    }
}

/// Put one payload into one room with no tauri state in reach.
fn send_room_headless(
    branch: &str,
    project_name: Option<&str>,
    payload: &SendPayload,
) -> SendOutcome {
    let project = match snapshot_project(project_name) {
        Ok(project) => project,
        Err(error) => return SendOutcome::failed(branch, project_name, error),
    };
    match send_room_in(&project, branch, payload) {
        Ok(room) => SendOutcome {
            project: project.name,
            branch: branch.to_string(),
            // Names WHICH mechanism ran, because "typed" and "pressed" are
            // different acts and an operator reading a log should see which.
            detail: Some(match payload {
                SendPayload::Text(_) => format!("typed into '{room}' - no newline appended"),
                SendPayload::Key(name) => format!("pressed {name} in '{room}'"),
            }),
            room: Some(room),
            sent: true,
            generated_at: now_iso8601(),
            error: None,
        },
        Err(error) => SendOutcome::failed(branch, Some(&project.name), error),
    }
}

/// What `--list-projects` prints: the switcher's census, whole, as an
/// envelope - headless callers get one object, never a bare array.
#[derive(Serialize)]
struct CensusOutcome {
    /// Every project BAUD can seat, anchor first - the same rows the desktop
    /// menu shows.
    projects: Vec<ProjectListing>,
    /// ISO-8601 UTC timestamp of this census.
    generated_at: String,
    /// Why the census is empty, when it is.
    error: Option<String>,
}

/// The switcher's census, headless. The seat is per-window state and a
/// headless process has no window, so `active` marks the anchor - the seat
/// every fresh window starts in. A remote client that keeps its own seat
/// overrides the flag locally.
fn list_projects_headless() -> CensusOutcome {
    match anchor_project() {
        Ok(anchor) => CensusOutcome {
            projects: discover_projects(&anchor)
                .into_iter()
                .map(|project| ProjectListing {
                    active: project.anchor,
                    name: project.name,
                    root: project.root.display().to_string(),
                    anchor: project.anchor,
                })
                .collect(),
            generated_at: now_iso8601(),
            error: None,
        },
        Err(error) => CensusOutcome {
            projects: Vec::new(),
            generated_at: now_iso8601(),
            error: Some(error),
        },
    }
}

/// What `--roster` prints: the system's working agents, as an envelope -
/// headless callers get one object, never a bare array.
#[derive(Serialize)]
struct RosterOutcome {
    /// Dispatched first, then live, then by project and name. That is
    /// [`agent_roster`]'s own ranking, passed through untouched: a caller
    /// drawing this as a wheel wants the order the desktop strip already
    /// shows, and re-sorting it here would put two answers in the system.
    branches: Vec<BranchStatus>,
    /// ISO-8601 UTC timestamp of this sweep.
    generated_at: String,
    /// Why the roster is empty, when it is EMPTY BECAUSE IT FAILED. An
    /// honestly empty roster - nobody working anywhere - carries no error, and
    /// the two must stay tellable apart: one says "nothing is happening", the
    /// other says "I could not look".
    error: Option<String>,
}

/// The system-wide working set, headless.
///
/// This is [`agent_roster`] with a way out of the binary, and deliberately
/// nothing more - the desktop's roster tabs and a phone's cross-project wheel
/// must not be able to disagree about who is working, so there is ONE sweep
/// and one ranking behind both.
fn roster_headless() -> RosterOutcome {
    match agent_roster() {
        Ok(branches) => RosterOutcome {
            branches,
            generated_at: now_iso8601(),
            error: None,
        },
        Err(error) => RosterOutcome {
            branches: Vec::new(),
            generated_at: now_iso8601(),
            error: Some(error),
        },
    }
}

fn capture_exit_code(outcome: &CaptureOutcome) -> i32 {
    i32::from(outcome.error.is_some())
}

fn send_exit_code(outcome: &SendOutcome) -> i32 {
    i32::from(outcome.error.is_some())
}

/// Run the headless half if the command line asked for it.
///
/// Returns the process exit code, or `None` to mean "carry on and open the
/// window". Errors never produce partial output: the JSON object is
/// serialized whole before a byte reaches stdout.
fn run_headless(args: &[String]) -> Option<i32> {
    match parse_invocation(args) {
        Invocation::Window => None,
        Invocation::Usage(problem) => {
            eprintln!("baud: {problem}");
            eprintln!("usage: baud --snapshot [--project <name>]");
            eprintln!("       baud --end-room <branch> [--project <name>]");
            eprintln!("       baud --capture-room <branch> [--project <name>] [--lines <N>]");
            eprintln!("       baud --send-room <branch> [--project <name>] (--text <s> | --key <NAME>)");
            eprintln!("       baud --list-projects");
            eprintln!("       baud --roster");
            Some(2)
        }
        Invocation::Snapshot { project } => {
            let snapshot = snapshot_headless(project.as_deref());
            match serde_json::to_string(&snapshot) {
                Ok(json) => {
                    println!("{json}");
                    if let Some(error) = &snapshot.error {
                        eprintln!("baud: {error}");
                    }
                    Some(snapshot_exit_code(&snapshot))
                }
                // Serializing our own struct cannot realistically fail, but
                // claiming success on an empty stdout would be a lie.
                Err(error) => {
                    eprintln!("baud: could not serialize the snapshot: {error}");
                    Some(1)
                }
            }
        }
        Invocation::EndRoom { branch, project } => {
            let outcome = end_room_headless(&branch, project.as_deref());
            emit(&outcome, outcome.error.as_deref(), kill_exit_code(&outcome))
        }
        Invocation::CaptureRoom {
            branch,
            project,
            lines,
        } => {
            let outcome = capture_room_headless(&branch, project.as_deref(), lines);
            emit(
                &outcome,
                outcome.error.as_deref(),
                capture_exit_code(&outcome),
            )
        }
        Invocation::SendRoom {
            branch,
            project,
            payload,
        } => {
            let outcome = send_room_headless(&branch, project.as_deref(), &payload);
            emit(&outcome, outcome.error.as_deref(), send_exit_code(&outcome))
        }
        Invocation::ListProjects => {
            let outcome = list_projects_headless();
            let code = i32::from(outcome.error.is_some());
            emit(&outcome, outcome.error.as_deref(), code)
        }
        Invocation::Roster => {
            let outcome = roster_headless();
            let code = i32::from(outcome.error.is_some());
            emit(&outcome, outcome.error.as_deref(), code)
        }
    }
}

/// Print one envelope whole and return its exit code.
///
/// Errors never produce partial output: the object is serialized completely
/// before a byte reaches stdout. Serializing our own struct cannot realistically
/// fail, but claiming success on an empty stdout would be a lie, so the
/// impossible case still gets an honest code.
fn emit<T: Serialize>(outcome: &T, error: Option<&str>, code: i32) -> Option<i32> {
    match serde_json::to_string(outcome) {
        Ok(json) => {
            println!("{json}");
            if let Some(error) = error {
                eprintln!("baud: {error}");
            }
            Some(code)
        }
        Err(error) => {
            eprintln!("baud: could not serialize the result: {error}");
            Some(1)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = run_headless(&args) {
        std::process::exit(code);
    }

    tauri::Builder::default()
        .manage(pty::PtyRegistry::default())
        .manage(ActiveProject::default())
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
            agent_roster,
            list_projects,
            project_switch,
            list_dir,
            read_file_text,
            resolve_paths,
            git_changes,
            git_project_changes,
            git_diff_text,
            room_kill,
            screenshot::screenshot_capture,
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::monitor_create,
            notifications::notifications_read,
            settings::agent_settings_read,
            settings::agent_settings_write,
            settings::baud_settings_read,
            settings::baud_settings_write,
            settings::hooks_sound_get,
            settings::hooks_sound_set,
            memory::memory_config_read,
            memory::memory_config_write,
            memory::memory_config_set,
            memory::memory_config_set_default,
            memory::memory_config_push
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

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_string()).collect()
    }

    #[test]
    fn no_snapshot_flag_opens_the_window() {
        assert_eq!(parse_invocation(&args(&[])), Invocation::Window);
        // tauri dev passes its own arguments - a strict parser here would
        // refuse to start the app, so anything without --snapshot falls
        // through untouched.
        assert_eq!(parse_invocation(&args(&["--other", "x"])), Invocation::Window);
    }

    #[test]
    fn snapshot_takes_an_optional_project() {
        assert_eq!(
            parse_invocation(&args(&["--snapshot"])),
            Invocation::Snapshot { project: None }
        );
        assert_eq!(
            parse_invocation(&args(&["--snapshot", "--project", "AIPASS"])),
            Invocation::Snapshot {
                project: Some("AIPASS".to_string())
            }
        );
        // Order is not load-bearing.
        assert_eq!(
            parse_invocation(&args(&["--project", "baud", "--snapshot"])),
            Invocation::Snapshot {
                project: Some("baud".to_string())
            }
        );
    }

    /// Once --snapshot is present the parse turns strict: the caller wanted
    /// data, so a typo must not silently hand back a different project - or a
    /// window.
    #[test]
    fn a_misspelled_flag_beside_snapshot_is_a_usage_error() {
        assert!(matches!(
            parse_invocation(&args(&["--snapshot", "--projekt", "baud"])),
            Invocation::Usage(_)
        ));
        assert!(matches!(
            parse_invocation(&args(&["--snapshot", "--project"])),
            Invocation::Usage(_)
        ));
        // A FLAG swallowed as a project name would send the read somewhere
        // the caller never named. Deliberately not `--snapshot` here: that
        // token is filtered out before the loop ever sees it, so it would
        // pass for the wrong reason and prove nothing about the guard.
        assert!(matches!(
            parse_invocation(&args(&["--snapshot", "--project", "--verbose"])),
            Invocation::Usage(_)
        ));
    }

    #[test]
    fn list_projects_parses_bare() {
        assert_eq!(
            parse_invocation(&args(&["--list-projects"])),
            Invocation::ListProjects
        );
    }

    #[test]
    fn roster_parses_bare() {
        assert_eq!(parse_invocation(&args(&["--roster"])), Invocation::Roster);
    }

    #[test]
    fn roster_refuses_a_project_scope() {
        // Crossing projects IS the roster. Accepting the flag and ignoring it
        // would hand back the whole system to a caller who asked for one
        // project - the opposite of a filter that silently did nothing.
        assert!(matches!(
            parse_invocation(&args(&["--roster", "--project", "BAUD"])),
            Invocation::Usage(_)
        ));
    }

    #[test]
    fn roster_refuses_a_branch_name() {
        // A positional argument beside a verb that takes none is a caller who
        // believes they scoped something.
        assert!(matches!(
            parse_invocation(&args(&["--roster", "devpulse"])),
            Invocation::Usage(_)
        ));
    }

    #[test]
    fn list_projects_refuses_a_project_scope() {
        // The census cannot be filtered; accepting and ignoring the flag would
        // read as a filter that worked.
        assert!(matches!(
            parse_invocation(&args(&["--list-projects", "--project", "BAUD"])),
            Invocation::Usage(_)
        ));
    }

    #[test]
    fn exit_code_reports_whether_the_payload_is_a_real_read() {
        let good = FleetSnapshot {
            project: "AIPASS".to_string(),
            root: "/tmp".to_string(),
            generated_at: now_iso8601(),
            error: None,
            branches: Vec::new(),
            live_agent_sessions: Vec::new(),
        };
        assert_eq!(snapshot_exit_code(&good), 0);
        assert_eq!(
            snapshot_exit_code(&FleetSnapshot::failed("no root".to_string())),
            1
        );
    }

    /// The contract @api codes against: the envelope keys are exactly these,
    /// and a failed read is still a whole JSON object rather than no output.
    #[test]
    fn a_failed_snapshot_still_serializes_the_full_envelope() {
        let json = serde_json::to_value(FleetSnapshot::failed("no root".to_string()))
            .expect("serializes");
        for key in [
            "project",
            "root",
            "generated_at",
            "error",
            "branches",
            "live_agent_sessions",
        ] {
            assert!(json.get(key).is_some(), "envelope is missing '{key}'");
        }
        assert_eq!(json["branches"].as_array().map(Vec::len), Some(0));
        assert!(json["error"].is_string(), "the reason is carried, not dropped");
    }

    /// A census the test owns outright: an anchor plus one nested project,
    /// both sealed by a registry, built under a private base so the sibling
    /// half of `discover_projects` can only ever see what was written here.
    /// Returns the base to clean up and the anchor to select against.
    fn census_fixture(tag: &str) -> (PathBuf, Project) {
        let base = std::env::temp_dir().join(format!("baud-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("root");

        let seal = |dir: &Path, name: &str| {
            fs::create_dir_all(join_all(dir, &FLEET_RELATIVE_DIR)).unwrap();
            fs::write(
                dir.join(format!("{name}{REGISTRY_SUFFIX}")),
                r#"{"branches":[{"path":"src/aipass/one"}]}"#,
            )
            .unwrap();
        };
        seal(&root, "FIXTUREROOT");
        seal(&root.join(PROJECTS_SUBDIR).join("nested"), "NESTED");

        let root = root.canonicalize().unwrap();
        let anchor = Project {
            name: "FIXTUREROOT".to_string(),
            fleet_dir: join_all(&root, &FLEET_RELATIVE_DIR),
            root,
            anchor: true,
        };
        (base, anchor)
    }

    #[test]
    fn an_unknown_project_name_is_refused_rather_than_defaulted() {
        let (base, anchor) = census_fixture("census-refuse");

        let error = select_project(anchor, Some("no-such-project-9f3a")).expect_err("refused");
        assert!(
            error.contains("no-such-project-9f3a"),
            "the error names what was asked for: {error}"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_named_project_resolves_out_of_the_census() {
        // The other half of the refusal: without this, a `select_project` that
        // simply never finds anything would pass the test above.
        let (base, anchor) = census_fixture("census-find");

        let seated = select_project(anchor.clone(), Some("NESTED")).expect("in the census");
        assert_eq!(seated.name, "NESTED");
        assert!(!seated.anchor, "only the anchor is the anchor");
        assert_eq!(seated.root, anchor.root.join(PROJECTS_SUBDIR).join("nested"));

        assert_eq!(
            select_project(anchor, None).expect("no name is the anchor").name,
            "FIXTUREROOT",
            "naming nothing seats the anchor, never a census entry"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn end_room_takes_a_branch_and_an_optional_project() {
        assert_eq!(
            parse_invocation(&args(&["--end-room", "devpulse"])),
            Invocation::EndRoom {
                branch: "devpulse".to_string(),
                project: None
            }
        );
        assert_eq!(
            parse_invocation(&args(&["--end-room", "devpulse", "--project", "AIPASS"])),
            Invocation::EndRoom {
                branch: "devpulse".to_string(),
                project: Some("AIPASS".to_string())
            }
        );
        // Order is not load-bearing here either.
        assert_eq!(
            parse_invocation(&args(&["--project", "AIPASS", "--end-room", "devpulse"])),
            Invocation::EndRoom {
                branch: "devpulse".to_string(),
                project: Some("AIPASS".to_string())
            }
        );
    }

    /// A kill with no target, or with two, must never guess which room was
    /// meant - the failure mode being guarded is ending the wrong session.
    #[test]
    fn an_ambiguous_end_room_is_a_usage_error() {
        assert!(matches!(
            parse_invocation(&args(&["--end-room"])),
            Invocation::Usage(_)
        ));
        assert!(matches!(
            parse_invocation(&args(&["--end-room", "--project", "AIPASS"])),
            Invocation::Usage(_)
        ));
        // Two branches named: which one did they want ended?
        assert!(matches!(
            parse_invocation(&args(&["--end-room", "devpulse", "api"])),
            Invocation::Usage(_)
        ));
        // A read verb and a destructive verb in one process.
        assert!(matches!(
            parse_invocation(&args(&["--snapshot", "--end-room", "devpulse"])),
            Invocation::Usage(_)
        ));
        // The snapshot's own positional-free strictness is unchanged: a bare
        // word beside --snapshot is still a typo, not a branch.
        assert!(matches!(
            parse_invocation(&args(&["--snapshot", "devpulse"])),
            Invocation::Usage(_)
        ));
    }

    /// The seam is fenced on NAMES. A path-shaped branch must be refused
    /// BEFORE anything resolves it, and the sentence must say so - otherwise
    /// the refusal reads as "no such branch" and the caller retries.
    #[test]
    fn a_path_shaped_branch_never_reaches_the_kill() {
        let (base, anchor) = census_fixture("kill-fence");

        for bad in ["../devpulse", "a/b", "a\\b", ".hidden"] {
            let error = end_room_in(&anchor, bad).expect_err("refused");
            assert!(
                error.contains("names, not paths"),
                "the refusal names the real problem for '{bad}': {error}"
            );
        }
        assert!(end_room_in(&anchor, "").expect_err("refused").contains("required"));

        let _ = fs::remove_dir_all(&base);
    }

    /// An unknown branch and an already-ended one are opposite facts. Flatten
    /// them and a caller holding a stale name is told the kill succeeded.
    #[test]
    fn an_unknown_branch_is_refused_and_a_quiet_one_is_not() {
        let (base, anchor) = census_fixture("kill-census");

        let error = end_room_in(&anchor, "no-such-branch-4b1e").expect_err("refused");
        assert!(
            error.contains("no-such-branch-4b1e") && error.contains("FIXTUREROOT"),
            "the refusal names the branch AND the project it looked in: {error}"
        );

        // The other half: a real branch with nothing running is a SUCCESS
        // carrying no room. Its name is deliberately one no live session could
        // answer to, so this stays true on a machine with tmux and on a runner
        // without one.
        let quiet = anchor.fleet_dir.join("quiet-fixture-branch-4b1e");
        fs::create_dir_all(&quiet).unwrap();
        assert_eq!(
            end_room_in(&anchor, "quiet-fixture-branch-4b1e").expect("nothing to end"),
            RoomEnded { room: None }
        );

        let _ = fs::remove_dir_all(&base);
    }

    /// The envelope's whole promise: exactly one of `detail`/`error` is set,
    /// and the exit code agrees with which. A caller reading only one field
    /// must not be able to mistake a refusal for a kill.
    #[test]
    fn a_kill_outcome_says_one_thing_and_the_exit_code_agrees() {
        let refused = KillOutcome::failed("devpulse", Some("AIPASS"), "nope".to_string());
        assert_eq!(refused.detail, None);
        assert_eq!(refused.error.as_deref(), Some("nope"));
        assert!(!refused.ended, "a refusal never claims it ended anything");
        assert_eq!(kill_exit_code(&refused), 1);

        let done = KillOutcome {
            project: "AIPASS".to_string(),
            branch: "devpulse".to_string(),
            room: Some("baud-devpulse".to_string()),
            ended: true,
            detail: Some("ended 'baud-devpulse'".to_string()),
            generated_at: now_iso8601(),
            error: None,
        };
        assert_eq!(kill_exit_code(&done), 0);
        // Nothing-to-end is a success too: the goal state was already reached.
        let quiet = KillOutcome {
            room: None,
            ended: false,
            detail: Some("nothing live for 'devpulse' - already ended".to_string()),
            ..done.clone()
        };
        assert_eq!(kill_exit_code(&quiet), 0);
        // And it is still distinguishable from the kill that did work.
        assert!(done.ended && !quiet.ended);
    }

    #[test]
    fn capture_room_takes_a_branch_a_project_and_a_depth() {
        assert_eq!(
            parse_invocation(&args(&["--capture-room", "devpulse"])),
            Invocation::CaptureRoom {
                branch: "devpulse".to_string(),
                project: None,
                lines: 0
            }
        );
        assert_eq!(
            parse_invocation(&args(&[
                "--capture-room",
                "devpulse",
                "--project",
                "AIPASS",
                "--lines",
                "200"
            ])),
            Invocation::CaptureRoom {
                branch: "devpulse".to_string(),
                project: Some("AIPASS".to_string()),
                lines: 200
            }
        );
        // A depth that is not a number at all is STRUCTURAL - the command
        // line itself is malformed, so it never runs.
        assert!(matches!(
            parse_invocation(&args(&["--capture-room", "devpulse", "--lines", "lots"])),
            Invocation::Usage(_)
        ));
        // But a number OUT OF RANGE is caller data arriving through a
        // well-formed line, so the parse accepts it and the door refuses it
        // with a sentence the operator can read. Over the cap is REFUSED, not
        // clamped: a caller who asked for 5000 and silently got 2000 would
        // believe they were looking at the whole history.
        assert_eq!(
            parse_invocation(&args(&["--capture-room", "devpulse", "--lines", "2001"])),
            Invocation::CaptureRoom {
                branch: "devpulse".to_string(),
                project: None,
                lines: 2001
            }
        );
        assert!(refuse_lines(2001).is_err());
        assert!(refuse_lines(-3).is_err());
        assert!(refuse_lines(0).is_ok() && refuse_lines(LINES_LIMIT).is_ok());
    }

    #[test]
    fn send_room_takes_exactly_one_of_text_or_key() {
        assert_eq!(
            parse_invocation(&args(&["--send-room", "devpulse", "--text", "ls -la"])),
            Invocation::SendRoom {
                branch: "devpulse".to_string(),
                project: None,
                payload: SendPayload::Text("ls -la".to_string())
            }
        );
        assert_eq!(
            parse_invocation(&args(&["--send-room", "devpulse", "--key", "C-c"])),
            Invocation::SendRoom {
                branch: "devpulse".to_string(),
                project: None,
                payload: SendPayload::Key("C-c".to_string())
            }
        );
        // Neither, and both, are refusals: the two are different mechanisms
        // (literal typing vs an interpreted keystroke) and guessing which one
        // a caller meant is how a paste turns into a control code.
        assert!(matches!(
            parse_invocation(&args(&["--send-room", "devpulse"])),
            Invocation::Usage(_)
        ));
        assert!(matches!(
            parse_invocation(&args(&["--send-room", "devpulse", "--text", "x", "--key", "Enter"])),
            Invocation::Usage(_)
        ));
        // A literal that LOOKS like a flag is still a literal - refusing it
        // would make `--text --help` impossible to type from a phone.
        assert_eq!(
            parse_invocation(&args(&["--send-room", "devpulse", "--text", "--help"])),
            Invocation::SendRoom {
                branch: "devpulse".to_string(),
                project: None,
                payload: SendPayload::Text("--help".to_string())
            }
        );
    }

    /// The allowlist is the whole safety of `--key`: `send-keys` without `-l`
    /// interprets its argument, so an unbounded name is an unbounded keystroke.
    #[test]
    fn only_allowlisted_key_names_are_accepted() {
        for name in [
            "Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "C-c", "C-d", "C-l", "C-u",
            "BSpace", "PageUp", "PageDown",
        ] {
            assert!(
                key_is_allowed(name),
                "{name} is named in the contract and must be accepted"
            );
        }
        for bad in ["kill", "C-z", "enter", "", "Enter Enter", "C-c;ls"] {
            assert!(!key_is_allowed(bad), "'{bad}' must not reach send-keys");
        }
        // The refusal is a VALUE refusal, not a usage one: the command line
        // was well formed and carried a key the caller chose. It therefore
        // travels as an envelope the operator can read, rather than becoming
        // "whoever invoked the binary built a bad line".
        assert_eq!(
            parse_invocation(&args(&["--send-room", "devpulse", "--key", "C-z"])),
            Invocation::SendRoom {
                branch: "devpulse".to_string(),
                project: None,
                payload: SendPayload::Key("C-z".to_string())
            }
        );
    }

    /// Text is typed, never executed. The flag cannot append a newline, so a
    /// paste alone can never run a command - submitting stays a separate,
    /// deliberate act. BAUD's own rule, carried out of `Terminal.tsx`.
    #[test]
    fn text_is_bounded_and_never_carries_a_newline_of_its_own() {
        assert!(refuse_text("").is_err(), "empty text has nothing to type");
        assert!(refuse_text("ls -la").is_ok());
        assert!(refuse_text(&"x".repeat(TEXT_LIMIT)).is_ok());
        let too_long = refuse_text(&"x".repeat(TEXT_LIMIT + 1)).expect_err("refused");
        assert!(
            too_long.contains(&TEXT_LIMIT.to_string()),
            "the refusal names the limit so the caller can act on it: {too_long}"
        );
        // The literal is handed to tmux verbatim: `send-keys -l` types the
        // characters, so a newline the OPERATOR typed is typed, and nothing is
        // ever appended on their behalf.
        assert_eq!(send_keys_args(&pane_target("baud-x"), &SendPayload::Text("ls\n".to_string())),
            vec!["send-keys", "-t", "=baud-x:", "-l", "--", "ls\n"]);
        // Without -l the name is interpreted - which is exactly why the
        // allowlist exists and why the two paths are separate argv shapes.
        assert_eq!(send_keys_args(&pane_target("baud-x"), &SendPayload::Key("C-c".to_string())),
            vec!["send-keys", "-t", "=baud-x:", "C-c"]);
    }

    /// `-e` keeps the escape sequences so the phone renders the same colours
    /// the desk sees; `-S -N` reaches N lines above the visible screen. The
    /// trailing colon is load-bearing: without it tmux refuses with "can't
    /// find pane", which is how the first live capture failed.
    #[test]
    fn capture_args_ask_for_colour_and_the_right_depth() {
        assert_eq!(
            capture_args(&pane_target("baud-x"), 0),
            vec!["capture-pane", "-p", "-e", "-t", "=baud-x:"]
        );
        assert_eq!(
            capture_args(&pane_target("baud-x"), 120),
            vec!["capture-pane", "-p", "-e", "-t", "=baud-x:", "-S", "-120"]
        );
    }

    /// A room that is not live cannot be captured or typed into, and saying
    /// "nothing here" is not the same as showing an empty screen - one is a
    /// fact about the fleet, the other looks like a dead agent.
    #[test]
    fn a_room_that_is_not_live_is_refused_by_both_new_doors() {
        let (base, anchor) = census_fixture("terminal-noroom");
        let quiet = anchor.fleet_dir.join("quiet-terminal-branch-7c2d");
        fs::create_dir_all(&quiet).unwrap();

        let captured = capture_room_in(&anchor, "quiet-terminal-branch-7c2d", 0).expect_err("refused");
        assert!(
            captured.contains("no room live"),
            "the refusal says the room is not there: {captured}"
        );
        let sent = send_room_in(
            &anchor,
            "quiet-terminal-branch-7c2d",
            &SendPayload::Key("Enter".to_string()),
        )
        .expect_err("refused");
        assert!(sent.contains("no room live"), "same sentence, same reason: {sent}");

        // And the name fence is shared with the kill door rather than copied.
        for bad in ["../devpulse", "a/b"] {
            assert!(capture_room_in(&anchor, bad, 0)
                .expect_err("refused")
                .contains("names, not paths"));
            assert!(send_room_in(&anchor, bad, &SendPayload::Key("Enter".to_string()))
                .expect_err("refused")
                .contains("names, not paths"));
        }

        let _ = fs::remove_dir_all(&base);
    }

    /// Same envelope promise as the kill: exactly one of detail/error, and the
    /// exit code agrees with which.
    #[test]
    fn terminal_envelopes_say_one_thing_and_the_codes_agree() {
        let refused = CaptureOutcome::failed("devpulse", Some("AIPASS"), "nope".to_string());
        assert_eq!(refused.detail, None);
        assert!(!refused.captured);
        assert_eq!(capture_exit_code(&refused), 1);

        let refused_send = SendOutcome::failed("devpulse", Some("AIPASS"), "nope".to_string());
        assert_eq!(refused_send.detail, None);
        assert!(!refused_send.sent, "a refusal never claims it typed anything");
        assert_eq!(send_exit_code(&refused_send), 1);
    }

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

    // Real line shapes from a live dispatched session (2026-08-10, @hooks
    // running two research sub-agents): spawn is an assistant `tool_use`
    // named "Agent", completion is a user `tool_result` echoing the id.
    fn spawn_line(id: &str) -> String {
        format!(
            r#"{{"type":"assistant","isSidechain":false,"message":{{"content":[{{"type":"tool_use","id":"{id}","name":"Agent","input":{{"description":"research"}}}}]}}}}"#
        )
    }

    fn result_line(id: &str) -> String {
        format!(
            r#"{{"type":"user","isSidechain":false,"message":{{"content":[{{"type":"tool_result","tool_use_id":"{id}","content":"done"}}]}}}}"#
        )
    }

    fn no_meta() -> std::collections::HashSet<String> {
        std::collections::HashSet::new()
    }

    #[test]
    fn meta_owned_spawns_are_excluded_from_tail_count() {
        // An async spawn still visible in the tail is counted by its file over
        // in async_agents_running - the tail must not count it a second time.
        let tail = format!("{}\n{}\n", spawn_line("toolu_01async"), spawn_line("toolu_01sync"));
        let meta: std::collections::HashSet<String> = ["toolu_01async".to_string()].into();
        assert_eq!(count_inflight_subagents(&tail, &meta), 1);
    }

    #[test]
    fn async_agents_counted_by_file_freshness() {
        // A real throwaway subagents dir: one agent writing now (running), one
        // long quiet (finished) - and both meta ids handed back for exclusion.
        let dir = std::env::temp_dir().join(format!("baud-async-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("agent-live1.meta.json"), r#"{"toolUseId":"toolu_01live"}"#).unwrap();
        fs::write(dir.join("agent-live1.jsonl"), "{}\n").unwrap();

        fs::write(dir.join("agent-done1.meta.json"), r#"{"toolUseId":"toolu_01done"}"#).unwrap();
        let quiet = dir.join("agent-done1.jsonl");
        fs::write(&quiet, "{}\n").unwrap();
        let long_ago =
            std::time::SystemTime::now() - std::time::Duration::from_secs(AGENT_FILE_ACTIVE_SECS * 4);
        let times = fs::FileTimes::new().set_modified(long_ago);
        fs::File::options().write(true).open(&quiet).unwrap().set_times(times).unwrap();

        let (meta_ids, running) = async_agents_running(&dir);
        assert_eq!(running, 1);
        assert!(meta_ids.contains("toolu_01live"));
        assert!(meta_ids.contains("toolu_01done"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unmatched_spawns_are_running_subagents() {
        // Two out, one back: exactly one still running.
        let tail = format!(
            "{}\n{}\n{}\n",
            spawn_line("toolu_01aaa"),
            spawn_line("toolu_01bbb"),
            result_line("toolu_01aaa")
        );
        assert_eq!(count_inflight_subagents(&tail, &no_meta()), 1);
    }

    #[test]
    fn resolved_spawns_and_other_tools_count_zero() {
        // A finished sub-agent and an in-flight Bash call: neither is a
        // running sub-agent.
        let bash = r#"{"type":"assistant","isSidechain":false,"message":{"content":[{"type":"tool_use","id":"toolu_01ccc","name":"Bash","input":{}}]}}"#;
        let tail = format!(
            "{}\n{}\n{bash}\n",
            spawn_line("toolu_01aaa"),
            result_line("toolu_01aaa")
        );
        assert_eq!(count_inflight_subagents(&tail, &no_meta()), 0);
    }

    #[test]
    fn task_name_and_sidechain_rules_hold() {
        // Older sessions spawn via "Task" - still a sub-agent. A sidechain's
        // own spawn-shaped line is the sub-agent talking, not the parent.
        let task = r#"{"type":"assistant","isSidechain":false,"message":{"content":[{"type":"tool_use","id":"toolu_01ddd","name":"Task","input":{}}]}}"#;
        let sidechain = r#"{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"tool_use","id":"toolu_01eee","name":"Agent","input":{}}]}}"#;
        let tail = format!("{task}\n{sidechain}\n");
        assert_eq!(count_inflight_subagents(&tail, &no_meta()), 1);
    }

    #[test]
    fn malformed_and_cut_lines_are_skipped() {
        // A tail read usually opens mid-line; garbage must read as zero, and
        // a cut first line must not hide the intact spawn after it.
        let cut = r#"ge":{"content":[{"type":"tool_use","id":"toolu_01fff","name":"Agent"}]}}"#;
        assert_eq!(count_inflight_subagents("not json at all\n", &no_meta()), 0);
        let tail = format!("{cut}\n{}\n", spawn_line("toolu_01ggg"));
        assert_eq!(count_inflight_subagents(&tail, &no_meta()), 1);
    }

    #[test]
    fn subagent_count_ties_to_recent_transcripts_only() {
        // A real throwaway transcripts dir: one stale session mid-spawn (a
        // crash last week must not light today's card) and one fresh.
        let dir = std::env::temp_dir().join(format!("baud-sub-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let stale = dir.join("old-session.jsonl");
        fs::write(&stale, spawn_line("toolu_01old")).unwrap();
        let last_week = std::time::SystemTime::now()
            - std::time::Duration::from_secs(SUBAGENT_LIVENESS_SECS * 4);
        let times = fs::FileTimes::new().set_modified(last_week);
        fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_times(times)
            .unwrap();

        let live = dir.join("live-session.jsonl");
        fs::write(&live, format!("{}\n{}\n", spawn_line("toolu_01one"), spawn_line("toolu_01two")))
            .unwrap();

        assert_eq!(subagent_count_in(&dir), 2);
        let _ = fs::remove_dir_all(&dir);
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
    fn project_total_counts_new_files_the_cards_cannot_see() {
        // The whole reason this counter exists: `diff HEAD` is blind to files
        // git has never seen, and a brand-new module is exactly the change an
        // operator most wants counted.
        let repo = std::env::temp_dir().join(format!("baud-gitproj-test-{}", std::process::id()));
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
        fs::write(repo.join("note.txt"), "old\n").unwrap();
        fs::write(repo.join(".gitignore"), "target/\n").unwrap();
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
        assert_eq!(git_project_changes_in(&repo).count, 0);

        // One tracked edit: both counters agree.
        fs::write(repo.join("note.txt"), "new\n").unwrap();
        assert_eq!(git_changes_in(&repo).count, 1);
        assert_eq!(git_project_changes_in(&repo).count, 1);

        // Untracked files, one of them nested: the card figure still says 1,
        // the project total sees all three. -uall is what expands the dir.
        fs::write(repo.join("fresh.rs"), "// new module\n").unwrap();
        fs::create_dir_all(repo.join("sub")).unwrap();
        fs::write(repo.join("sub").join("deep.rs"), "// nested\n").unwrap();
        assert_eq!(git_changes_in(&repo).count, 1);
        assert_eq!(git_project_changes_in(&repo).count, 3);

        // Ignored paths never reach the count.
        fs::create_dir_all(repo.join("target")).unwrap();
        fs::write(repo.join("target").join("huge.bin"), "junk\n").unwrap();
        assert_eq!(git_project_changes_in(&repo).count, 3);

        // Not a repo: quiet zero, same doctrine as every other fallible read.
        let _ = fs::remove_dir_all(repo.join(".git"));
        assert_eq!(git_project_changes_in(&repo).count, 0);
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
    fn citizen_class_is_repeated_verbatim_never_invented() {
        let dir = std::env::temp_dir().join(format!("baud-class-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let trinity = dir.join(".trinity");
        fs::create_dir_all(&trinity).unwrap();

        // No passport: no class to report, and that is not an error.
        assert_eq!(citizen_class_of(&dir), "");

        // Whatever the file says, unjudged - including a class BAUD has never
        // heard of, which is the whole point of carrying the string.
        for class in ["manager", "aipass_framework", "some_future_class"] {
            fs::write(
                trinity.join("passport.json"),
                format!(r#"{{"identity": {{"citizen_class": "{class}"}}}}"#),
            )
            .unwrap();
            assert_eq!(citizen_class_of(&dir), class);
            assert_eq!(citizen_class_of(&dir) == "manager", class == "manager");
        }

        // Malformed, and key absent: the empty string both times. A class is a
        // claim the FILE makes, so an unreadable file makes none.
        fs::write(trinity.join("passport.json"), "not json").unwrap();
        assert_eq!(citizen_class_of(&dir), "");
        fs::write(trinity.join("passport.json"), r#"{"identity": {}}"#).unwrap();
        assert_eq!(citizen_class_of(&dir), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn manager_mark_is_claimed_only_when_the_passport_says_so() {
        let dir = std::env::temp_dir().join(format!("baud-mgr-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let trinity = dir.join(".trinity");
        fs::create_dir_all(&trinity).unwrap();

        // No passport at all: not a manager, not an error.
        assert_ne!(citizen_class_of(&dir), "manager");

        // The real shape, both live values seen in the fleet.
        fs::write(
            trinity.join("passport.json"),
            r#"{"identity": {"citizen_class": "manager", "role": "project_agent"}}"#,
        )
        .unwrap();
        assert_eq!(citizen_class_of(&dir), "manager");

        fs::write(
            trinity.join("passport.json"),
            r#"{"identity": {"citizen_class": "aipass_framework"}}"#,
        )
        .unwrap();
        assert_ne!(citizen_class_of(&dir), "manager");

        // A citizen whose passport omits the key is a builder, not a manager.
        fs::write(trinity.join("passport.json"), r#"{"identity": {}}"#).unwrap();
        assert_ne!(citizen_class_of(&dir), "manager");

        // Malformed JSON reads quiet-false, never takes the snapshot down.
        fs::write(trinity.join("passport.json"), "not json").unwrap();
        assert_ne!(citizen_class_of(&dir), "manager");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn room_names_are_tmux_safe() {
        assert_eq!(room_name(None, "devpulse"), "baud-devpulse");
        assert_eq!(room_name(None, "ai_mail"), "baud-ai_mail");
        // '.' and ':' carry tmux target syntax; anything odd flattens to '-'.
        assert_eq!(room_name(None, "AIPASS.admin"), "baud-AIPASS-admin");
        assert_eq!(room_name(None, "a:b c"), "baud-a-b-c");
    }

    /// The row publishes the name, and it is the SAME name `room_name` builds -
    /// which is the whole value of the field. A second derivation anywhere (a
    /// python mirror of the sanitizer, a hand-built string in a face) is a rule
    /// that can disagree with this one; a row that carries the answer cannot.
    #[test]
    fn a_row_carries_the_name_of_its_own_room() {
        let base = std::env::temp_dir().join(format!("baud-roomfield-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let branch = base.join("ai_mail");
        fs::create_dir_all(&branch).unwrap();

        let quiet = RoomScan::default();
        let anchor = read_branch(&branch, "ai_mail".into(), "AIPASS", &[], &quiet, None);
        assert_eq!(anchor.room, "baud-ai_mail");
        assert_eq!(anchor.room, room_name(None, "ai_mail"));
        // Nothing is running in this fixture, so the name is what a launch
        // WOULD create - stated all the same.
        assert!(!anchor.has_room);

        let scoped = read_branch(&branch, "ai_mail".into(), "VERA-STUDIO", &[], &quiet, Some("vera-studio"));
        assert_eq!(scoped.room, "baud-vera-studio-ai_mail");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn external_rooms_carry_the_project_scope() {
        // Anchor rooms keep their historical plain names; a seated external
        // project marks its rooms so same-named branches can never collide.
        assert_eq!(room_name(Some("vera-studio"), "vera"), "baud-vera-studio-vera");
        assert_eq!(room_name(Some("chess"), "chess"), "baud-chess-chess");
        // The scope is sanitized through the same charset as the branch.
        assert_eq!(room_name(Some("a.b:c"), "x"), "baud-a-b-c-x");

        let anchor = Project {
            name: "AIPASS".into(),
            root: PathBuf::from("/x"),
            fleet_dir: PathBuf::from("/x/src/aipass"),
            anchor: true,
        };
        assert_eq!(anchor.room_scope(), None);
        let external = Project {
            name: "VERA-STUDIO".into(),
            anchor: false,
            ..anchor
        };
        assert_eq!(external.room_scope().as_deref(), Some("vera-studio"));
    }

    #[test]
    fn rooms_are_listed_while_alive_and_killable() {
        // A real throwaway tmux session - the machine runs on tmux (the whole
        // rooms doctrine leans on it), so exercise the actual verbs.
        let branch = format!("roomtest-{}", std::process::id());
        let room = room_name(None, &branch);
        let spawned = Command::new("tmux")
            .args(["new-session", "-d", "-s", &room])
            .output()
            .expect("tmux must be runnable for the rooms test");
        assert!(spawned.status.success(), "could not create test room");

        assert!(scan_rooms().names.contains(&room), "live room missing from list");

        room_kill_named(&room).expect("ending a live room must succeed");
        assert!(!scan_rooms().names.contains(&room), "room survived room_kill");

        // Ending a room that is already gone is idempotent success.
        room_kill_named(&room).expect("ending a dead room must be a no-op");
    }

    #[test]
    fn panes_parse_into_names_and_agent_panes() {
        // The exact shape `list-panes -a` hands back, including a plain shell
        // pane (never an agent room) and a pane tmux reported without a path.
        let scan = parse_panes(concat!(
            "aipass-aipass\tclaude\t/x/src/aipass/aipass\n",
            "baud-devpulse\tclaude\t/x/src/aipass/devpulse\n",
            "work\tbash\t/x/src/aipass/aipass\n",
            "broken\tclaude\t\n",
            "\n",
        ));

        assert_eq!(scan.names.len(), 4, "every session name is kept");
        assert!(scan.names.contains("work"));
        // Only claude panes carrying a path become candidates.
        assert_eq!(
            scan.agent_panes,
            vec![
                ("aipass-aipass".to_string(), PathBuf::from("/x/src/aipass/aipass")),
                ("baud-devpulse".to_string(), PathBuf::from("/x/src/aipass/devpulse")),
            ]
        );
    }

    #[test]
    fn outside_sessions_are_adopted_only_when_they_hold_an_agent() {
        let scan = parse_panes(concat!(
            "aipass-aipass\tclaude\t/x/src/aipass/aipass\n",
            "telegram-prax\tclaude\t/x/src/aipass/prax/logs\n",
            "baud-flow\tclaude\t/x/src/aipass/flow\n",
            "mine\tbash\t/x/src/aipass/cli\n",
        ));

        // The boot shim's session, found by the branch its pane sits in.
        assert_eq!(
            scan.agent_session_in(Path::new("/x/src/aipass/aipass")).as_deref(),
            Some("aipass-aipass")
        );
        // A pane deeper inside the branch still belongs to the branch.
        assert_eq!(
            scan.agent_session_in(Path::new("/x/src/aipass/prax")).as_deref(),
            Some("telegram-prax")
        );
        // BAUD's own rooms are never "outside" - they belong to a card already.
        assert_eq!(scan.agent_session_in(Path::new("/x/src/aipass/flow")), None);
        // The operator's own shell is not an agent, and never gets adopted.
        assert_eq!(scan.agent_session_in(Path::new("/x/src/aipass/cli")), None);
        // starts_with is component-wise: "aipas" never claims "aipass".
        assert_eq!(scan.agent_session_in(Path::new("/x/src/aipass/ai")), None);
    }

    #[test]
    fn live_agent_sessions_need_an_interactive_claude_in_the_pane() {
        // The chips' question (m13): "is anyone home in the session I am
        // attached to?" - asked of the session, never of the seat.
        let dir = std::env::temp_dir().join(format!("baud-livesess-{}", std::process::id()));
        let (mine, theirs) = (dir.join("mine"), dir.join("theirs"));
        fs::create_dir_all(&mine).unwrap();
        fs::create_dir_all(&theirs).unwrap();
        let (mine, theirs) = (mine.canonicalize().unwrap(), theirs.canonicalize().unwrap());

        let scan = parse_panes(&format!(
            "baud-mine\tclaude\t{}\nfar-away\tclaude\t{}\nshell\tbash\t{}\n",
            mine.display(),
            theirs.display(),
            mine.display(),
        ));

        let sessions = vec![
            ClaudeSession { cwd: mine.clone(), headless: false },
            // A dispatched wake in the other room: a claude pane, but no chat
            // box - typing a slash command into it would go nowhere.
            ClaudeSession { cwd: theirs.clone(), headless: true },
        ];

        assert_eq!(
            scan.live_agent_sessions(&sessions),
            vec!["baud-mine".to_string()],
            "only the session holding an INTERACTIVE claude counts"
        );

        // The same room, now seating a human-driven session: it qualifies, and
        // it qualifies without anyone asking which project BAUD is seated in.
        let sessions = vec![ClaudeSession { cwd: theirs, headless: false }];
        assert_eq!(scan.live_agent_sessions(&sessions), vec!["far-away".to_string()]);

        assert!(
            scan.live_agent_sessions(&[]).is_empty(),
            "no claude processes at all means no chips anywhere"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_plain_shell_session_is_never_adopted_live() {
        // The hazard this guards: adopting the operator's own tmux session
        // would have BAUD typing a claude command line into their shell.
        let dir = std::env::temp_dir().join(format!("baud-shelltest-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let canonical = dir.canonicalize().unwrap();
        let session = format!("baudshell-{}", std::process::id());
        let spawned = Command::new("tmux")
            .args(["new-session", "-d", "-s", &session, "-c"])
            .arg(&canonical)
            .output()
            .expect("tmux must be runnable for the rooms test");
        assert!(spawned.status.success(), "could not create test session");

        let scan = scan_rooms();
        assert!(scan.names.contains(&session), "live session missing from scan");
        assert_eq!(
            scan.agent_session_in(&canonical),
            None,
            "a shell pane must never read as an agent's room"
        );

        room_kill_named(&session).expect("ending the test session must succeed");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_claude_processes_are_ignored() {
        assert_eq!(classify_claude_cmdline(&argv(&["tmux", "new-session"])), None);
        assert_eq!(classify_claude_cmdline(&argv(&["/usr/bin/claudette"])), None);
        assert_eq!(classify_claude_cmdline(&argv(&[])), None);
        assert_eq!(classify_claude_cmdline(b""), None);
    }

    #[test]
    fn sealed_dirs_read_as_projects() {
        let base = std::env::temp_dir().join(format!("baud-seal-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);

        // A modern sealed project: the registry's own branch paths name the
        // fleet dir; the filename stem names the project.
        let vera = base.join("Vera-Studio");
        fs::create_dir_all(vera.join("src/vera_studio/vera")).unwrap();
        fs::write(
            vera.join("VERA-STUDIO_REGISTRY.json"),
            r#"{"metadata":{},"branches":[{"name":"VERA","path":"src/vera_studio/vera"}]}"#,
        )
        .unwrap();
        let project = project_from_dir(&vera, false).expect("sealed dir reads as a project");
        assert_eq!(project.name, "VERA-STUDIO");
        assert_eq!(project.fleet_dir, vera.join("src/vera_studio"));
        assert!(!project.anchor);

        // No seal: not a project.
        let bare = base.join("bare");
        fs::create_dir_all(&bare).unwrap();
        assert!(project_from_dir(&bare, false).is_none());

        // Sealed but no branch paths: nothing to card, not switchable.
        let empty = base.join("empty");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join("EMPTY_REGISTRY.json"), r#"{"branches":[]}"#).unwrap();
        assert!(project_from_dir(&empty, false).is_none());

        // Legacy flat layout - branches sit at the root itself: unswitchable.
        let flat = base.join("flat");
        fs::create_dir_all(flat.join("devpulse")).unwrap();
        fs::write(
            flat.join("FLAT_REGISTRY.json"),
            r#"{"branches":[{"path":"devpulse"}]}"#,
        )
        .unwrap();
        assert!(project_from_dir(&flat, false).is_none());

        // Two seals in one dir (legacy trees): the lexically first wins.
        let twin = base.join("twin");
        fs::create_dir_all(twin.join("src/twin/one")).unwrap();
        for seal in ["B_REGISTRY.json", "A_REGISTRY.json"] {
            fs::write(twin.join(seal), r#"{"branches":[{"path":"src/twin/one"}]}"#).unwrap();
        }
        assert_eq!(project_from_dir(&twin, false).unwrap().name, "A");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn discovery_covers_anchor_nested_and_siblings_without_duplicates() {
        let base = std::env::temp_dir().join(format!("baud-disco-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);

        let seal = |dir: &Path, name: &str, fleet: &str| {
            fs::create_dir_all(dir.join(fleet).join("one")).unwrap();
            fs::write(
                dir.join(format!("{name}_REGISTRY.json")),
                format!(r#"{{"branches":[{{"path":"{fleet}/one"}}]}}"#),
            )
            .unwrap();
        };

        let anchor_dir = base.join("AIPass");
        seal(&anchor_dir, "AIPASS", "src/aipass");
        seal(&anchor_dir.join("projects").join("baud"), "BAUD", "src/baud");
        seal(&base.join("Vera-Studio"), "VERA-STUDIO", "src/vera_studio");
        // A sibling with no seal is not a project and never listed.
        fs::create_dir_all(base.join("scratch")).unwrap();

        let anchor = project_from_dir(&anchor_dir, true).expect("anchor seals");
        let names: Vec<String> = discover_projects(&anchor)
            .into_iter()
            .map(|project| project.name)
            .collect();
        // Anchor first (never duplicated by the sibling scan), rest sorted.
        assert_eq!(names, vec!["AIPASS", "BAUD", "VERA-STUDIO"]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_fence_follows_the_given_root() {
        let base = std::env::temp_dir().join(format!("baud-fence-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (yard_a, yard_b) = (base.join("a"), base.join("b"));
        fs::create_dir_all(&yard_a).unwrap();
        fs::create_dir_all(&yard_b).unwrap();
        fs::write(yard_a.join("mine.txt"), "a").unwrap();
        fs::write(yard_b.join("theirs.txt"), "b").unwrap();

        let mine = yard_a.join("mine.txt").display().to_string();
        let theirs = yard_b.join("theirs.txt").display().to_string();

        // Seated in A: A's file opens, B's is refused. Reseat in B: reversed.
        assert!(fenced_path_in(&yard_a, &mine).is_ok());
        assert!(fenced_path_in(&yard_a, &theirs).is_err());
        assert!(fenced_path_in(&yard_b, &theirs).is_ok());
        assert!(fenced_path_in(&yard_b, &mine).is_err());

        let _ = fs::remove_dir_all(&base);
    }

    /// A throwaway stand-in for a seated project, built from nothing: a root
    /// with its own README, a `projects/baud/README.md` for the seated-dir
    /// case to prefer, a directory to prove directories never open, and one
    /// real file deliberately OUTSIDE the fence.
    ///
    /// These two tests used to reach for the live AIPass tree through
    /// `resolve_aipass_root()`, which only ever worked because this repo
    /// happens to be cloned inside that tree - CI's bare checkout proved the
    /// assumption false on its first run. `resolve_paths_in` takes its root as
    /// an argument, so a fixture is all this needs: no ambient tree, and no
    /// `AIPASS_ROOT` either, which as a process-wide env var would race the
    /// other tests running alongside these on their own threads.
    ///
    /// Returns `(base, root)` - `base` to delete, `root` canonicalized because
    /// the fence compares canonical paths.
    fn resolve_fixture(tag: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("baud-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let seated = base.join("root").join("projects").join("baud");
        fs::create_dir_all(&seated).unwrap();
        fs::write(base.join("root").join("README.md"), "root readme\n").unwrap();
        fs::write(seated.join("README.md"), "seated readme\n").unwrap();
        // Outside the fence by construction: a sibling of the root, not under it.
        fs::write(base.join("outside.txt"), "not yours to open\n").unwrap();
        let root = base.join("root").canonicalize().unwrap();
        (base, root)
    }

    #[test]
    fn resolve_paths_only_links_real_fenced_files() {
        let (base, root) = resolve_fixture("resolve-test");
        let readme = root.join("README.md");
        let outside = base.join("outside.txt");
        assert!(outside.is_file(), "the fixture's out-of-fence file must be real");

        let hits = resolve_paths_in(
            &root,
            None,
            &[
                readme.display().to_string(),   // absolute, real
                "README.md".to_string(),        // relative -> root fallback
                outside.display().to_string(),  // real file OUTSIDE the fence
                "no/such/file.xyz".to_string(), // nonexistent
                "projects".to_string(),         // a directory, not a file
            ],
        );

        assert_eq!(hits[0].as_deref(), Some(readme.display().to_string().as_str()));
        assert_eq!(hits[1].as_deref(), Some(readme.display().to_string().as_str()));
        assert_eq!(hits[2], None, "the fence must hold");
        assert_eq!(hits[3], None);
        assert_eq!(hits[4], None, "directories do not open in the viewer");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_paths_prefers_the_seated_branch_dir() {
        // `README.md` is ambiguous: the seated room's copy must win over the
        // project root's.
        let (base, root) = resolve_fixture("seated-test");
        let seated = root.join("projects").join("baud");

        let hits = resolve_paths_in(
            &root,
            Some(seated.display().to_string()).as_deref(),
            &["README.md".to_string()],
        );
        let hit = hits[0].as_deref().expect("the seated dir's README resolves");
        assert!(
            hit.ends_with("projects/baud/README.md"),
            "expected the seated dir's file, got {hit}"
        );

        let _ = fs::remove_dir_all(&base);
    }
}
