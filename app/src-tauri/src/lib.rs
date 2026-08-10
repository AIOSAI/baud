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

use std::fs;
use std::path::{Path, PathBuf};

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

/// The per-branch status file that services keep up to date.
const DASHBOARD_FILE: &str = "DASHBOARD.local.json";

/// One branch directory under `<root>/src/aipass/`.
#[derive(Debug, Clone, Serialize)]
pub struct BranchStatus {
    /// Directory name, e.g. "devpulse".
    pub name: String,
    /// `.trinity/passport.json` exists.
    pub is_citizen: bool,
    /// `.ai_mail.local/.dispatch.lock` exists - the agent is awake right now.
    pub working: bool,
    /// `quick_status.new_mail`, 0 when missing or unreadable.
    pub new_mail: u64,
    /// `quick_status.active_plans`, 0 when missing or unreadable.
    pub active_plans: u64,
    /// `quick_status.action_required`, false when missing or unreadable.
    pub action_required: bool,
    /// `quick_status.summary`, empty when missing or unreadable.
    pub summary: String,
    /// Top-level `last_updated`, empty when missing or unreadable.
    pub last_updated: String,
}

impl BranchStatus {
    fn new(name: String) -> Self {
        Self {
            name,
            is_citizen: false,
            working: false,
            new_mail: 0,
            active_plans: 0,
            action_required: false,
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

/// Read a `quick_status` count that may be a number or a list of items.
fn count_field(quick_status: &Value, key: &str) -> u64 {
    match quick_status.get(key) {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::Array(items)) => items.len() as u64,
        Some(Value::String(text)) => text.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

/// Overlay whatever `DASHBOARD.local.json` has to say onto a branch status.
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

    status.new_mail = count_field(quick_status, "new_mail");
    status.active_plans = count_field(quick_status, "active_plans");
    status.action_required = quick_status
        .get("action_required")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    status.summary = quick_status
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
}

/// Inspect a single branch directory. Never fails - worst case it reports a
/// bare directory with all-default fields.
fn read_branch(branch_dir: &Path, name: String) -> BranchStatus {
    let mut status = BranchStatus::new(name);
    status.is_citizen = join_all(branch_dir, &PASSPORT_RELATIVE_PATH).is_file();
    status.working = join_all(branch_dir, &DISPATCH_LOCK_RELATIVE_PATH).exists();
    apply_dashboard(branch_dir, &mut status);
    status
}

/// Scan `<root>/src/aipass/*/` - visible directories only.
fn scan_fleet(root: &Path) -> Result<Vec<BranchStatus>, String> {
    let fleet_dir = join_all(root, &FLEET_RELATIVE_DIR);

    let entries = fs::read_dir(&fleet_dir)
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

        branches.push(read_branch(&entry.path(), name));
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
        .invoke_handler(tauri::generate_handler![
            fleet_snapshot,
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        // Closing the window must take the shell with it. Both hooks fire in
        // the normal quit path; whichever runs first does the work, and
        // `shutdown` on an empty registry is free.
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
