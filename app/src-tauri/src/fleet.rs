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
#[tauri::command]
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
