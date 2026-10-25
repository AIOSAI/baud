//! THE FLEET READ - one pass over the branch directories, one snapshot out.
//!
//! EVERY FALLIBLE READ DEGRADES TO A DEFAULT. A missing dashboard, malformed
//! JSON, an unreadable entry, a branch with no passport: each falls back for
//! that one card and never fails the poll. A snapshot that read nothing is not
//! an empty fleet, and it carries its own sentence saying so.
//!
//! Lifted out of lib.rs by FPLAN-0445 without a line of it changing.

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::*;

/// Whether `.ai_mail.local/.dispatch.lock` names a process that is alive.
///
/// The lock is JSON written by ai_mail's dispatcher: `pid`, `timestamp`,
/// `branch`, and a `subject` the brief's three-key reading did not know
/// about - extra keys are tolerated, only an integer `pid` is required. That
/// pid is the DISPATCH MONITOR (`dispatch_monitor.py @<branch>`, python3),
/// not the claude it watches - measured on a live lock during a real dispatch
/// (FPLAN-0492) - so the `/proc` claude pass can never vouch for it and
/// `/proc/<pid>` is stat'ed directly instead: one syscall, no second walk of
/// the process table.
///
/// The existence test this replaces was the bug: ai_mail reclaims a stale
/// lock only on the NEXT dispatch after its 600 s window, so after a reboot
/// a dead lock kept a card in the dispatched wheel for hours (2.5 h
/// measured). A missing, unreadable, pid-less or dead-pid lock reads not
/// dispatched.
pub(crate) fn dispatch_lock_live(branch_dir: &Path) -> bool {
    let Ok(text) = fs::read_to_string(join_all(branch_dir, &DISPATCH_LOCK_RELATIVE_PATH)) else {
        return false;
    };
    let Ok(lock) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    let Some(pid) = lock.get("pid").and_then(Value::as_u64) else {
        return false;
    };
    pid_alive(pid)
}

/// A process with this pid exists right now: `/proc/<pid>` is a directory.
/// Pid 0 is never a process. A zombie keeps its entry until reaped, which is
/// the right reading - the dispatcher's own reap is what ends a wake.
pub(crate) fn pid_alive(pid: u64) -> bool {
    pid != 0 && Path::new("/proc").join(pid.to_string()).is_dir()
}

/// Count mailbox messages by status straight from `inbox.json`.
///
/// Closed mail is archived out of the file, so the inbox only ever holds
/// "new" and "opened" messages. A missing or malformed file reads as an
/// empty mailbox - same quiet-zero doctrine as the git figure.
pub(crate) fn mail_counts_in(branch_dir: &Path) -> (u64, u64) {
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
pub(crate) fn citizen_class_of(branch_dir: &Path) -> String {
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

/// Read a `quick_status` count that may be a number or a list of items.
///
/// Moved from reads.rs by FPLAN-0589 without a line of it changing: the fleet
/// read is its only caller, and reads.rs now builds only with the window.
pub(crate) fn count_field(quick_status: &Value, key: &str) -> u64 {
    match quick_status.get(key) {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::Array(items)) => items.len() as u64,
        Some(Value::String(text)) => text.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

/// Overlay whatever `DASHBOARD.local.json` has to say onto a branch status.
///
/// Mail counts are NOT taken from here - see [`mail_counts_in`].
///
/// A missing, unreadable, or malformed file leaves the defaults in place - one
/// bad JSON file must never take down the whole snapshot.
pub(crate) fn apply_dashboard(branch_dir: &Path, status: &mut BranchStatus) {
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

/// The card's provider, history flag and resume id. A live session names the
/// provider, since a pointer is history; else the pointer's, else claude. The
/// pointer's id is the resume door only while its provider is the card's:
/// `claude --resume` on a Codex thread fails the launch. A codex card has no
/// transcript scan, so `claude_history` runs only for claude.
pub(crate) fn resume_door(
    live: Option<&'static str>,
    pointer: Option<(&'static str, String)>,
    claude_history: impl FnOnce() -> (bool, Option<String>),
) -> (&'static str, bool, Option<String>) {
    let provider = live.or(pointer.as_ref().map(|(provider, _)| *provider)).unwrap_or("claude");
    let pointed = pointer.filter(|(from, _)| *from == provider).map(|(_, id)| id);
    if provider == "codex" {
        return (provider, false, pointed);
    }
    let (has_history, scanned) = claude_history();
    (provider, has_history, pointed.or(scanned))
}

/// Inspect a single branch directory. Never fails - worst case it reports a
/// bare directory with all-default fields.
pub(crate) fn read_branch(
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
    status.dispatched = dispatch_lock_live(branch_dir);

    // /proc reports kernel-canonical cwds; canonicalize the branch dir so a
    // symlinked AIPASS_ROOT still matches. starts_with is component-wise, so
    // "devpulse" never claims a session sitting in "devpulse2".
    let canonical = branch_dir
        .canonicalize()
        .unwrap_or_else(|_| branch_dir.to_path_buf());
    status.interactive = sessions
        .iter()
        .any(|session| !session.headless && session.cwd.starts_with(&canonical));
    // FPLAN-0448: the branch's own session pointer (written by dispatch on
    // every wake) outranks the transcript-scan guess — the scan's `-c` door
    // can never enter a dispatched session. No pointer → the old guess, so a
    // branch that predates the pointer resumes exactly as before.
    let live_provider = sessions
        .iter()
        .find(|session| session.cwd.starts_with(&canonical))
        .map(|session| session.provider);
    let (provider, has_history, resume_id) =
        resume_door(live_provider, session_pointer(&canonical), || claude_history(&canonical));
    status.provider = provider.to_string();
    status.has_history = has_history;
    status.resume_id = resume_id;
    status.subagents = subagent_count(&canonical);

    // Named once and used twice: the badge asks whether this session exists,
    // the row carries the name either way. Deriving it a second time here is
    // exactly the duplication this field exists to retire upstream.
    status.room = room_name(room_scope, &status.name);
    status.has_room = rooms.names.contains(&status.room);
    status.own_room_live = rooms.holds_claude(&status.room);
    // Ruled B (Patrick, 2026-09-07, ONE ROOM step 2): a room holding no claude
    // never outranks a live seat. The own room silences the outside seat only
    // while a claude is actually IN it - `own_room_live`, not `has_room`. The
    // old arm keyed on `has_room`, so an empty `baud-` room hid the live seat
    // from both faces (the 09-04 blank terminal). The doors follow the same
    // rule through `RoomScan::door_session`.
    status.outside_room = if status.own_room_live {
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
pub(crate) fn scan_fleet(project: &Project) -> Result<(Vec<BranchStatus>, Vec<String>), String> {
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
pub(crate) fn branches_of(
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
// Also the roster behind baud-cli's --roster, so only the command half is gated.
#[cfg_attr(feature = "gui", tauri::command)]
pub fn agent_roster() -> Result<Vec<BranchStatus>, String> {
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
#[cfg(feature = "gui")]
#[tauri::command]
pub fn fleet_snapshot(state: tauri::State<'_, ActiveProject>) -> FleetSnapshot {
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
