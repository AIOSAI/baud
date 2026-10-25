//! ROOMS - the tmux sessions an agent lives in, named, scanned, and steered.
//!
//! BAUD NAMES ITS ROOMS, so BAUD says the name: the sanitizer below is the one
//! place a branch name becomes a tmux session name, and any other runtime that
//! rebuilds that rule will disagree with this one eventually.
//!
//! The send door types and never runs - `send-keys -l` inserts characters and
//! cannot append a newline, so a paste alone can never submit. The allowlist and
//! the two refusals beside it are what keep that true.
//!
//! Lifted out of lib.rs by FPLAN-0445 without a line of it changing.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::*;

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

/// The command names tmux reports for a pane running an agent session, claude
/// or codex. An install that shows up as something else (a node shim, a
/// wrapper script) simply never matches - that costs a card its outside-room
/// tag, which is the same place we stood before m12. A LOOSER test would be
/// worse: BAUD would treat the operator's own shell session as an agent's room
/// and type into it.
pub(crate) const AGENT_PANE_COMMANDS: [&str; 2] = ["claude", "codex"];

/// What one tmux round-trip tells the snapshot.
#[derive(Debug, Default)]
pub(crate) struct RoomScan {
    /// Every live session name on the server.
    pub(crate) names: std::collections::HashSet<String>,
    /// `(session name, pane cwd)` for every pane running a claude, in the
    /// order tmux listed them.
    pub(crate) agent_panes: Vec<(String, PathBuf)>,
}

impl RoomScan {
    /// The session holding a claude seated in `dir`, ignoring BAUD's own
    /// rooms - those belong to a card already, and a `baud-` room whose name
    /// does not match this branch is not this branch's business. Ties break
    /// on the session name so two candidates always resolve the same way.
    pub(crate) fn agent_session_in(&self, dir: &Path) -> Option<String> {
        let mut found: Vec<&String> = self
            .agent_panes
            .iter()
            .filter(|(name, cwd)| !name.starts_with(ROOM_PREFIX) && cwd.starts_with(dir))
            .map(|(name, _)| name)
            .collect();
        found.sort();
        found.first().map(|name| (*name).clone())
    }

    /// Whether the session named `session` holds a pane running a claude - the
    /// one question ruled B turns on (Patrick, 2026-09-07, ONE ROOM step 2): a
    /// room that exists but holds no claude is a shell waiting, and it never
    /// outranks a live seat elsewhere in the branch. Pane-command test, the
    /// same one `agent_panes` is built from, so an interactive claude and a
    /// dispatched headless one both count as "holds a claude".
    pub(crate) fn holds_claude(&self, session: &str) -> bool {
        self.agent_panes.iter().any(|(name, _)| name == session)
    }

    /// The session a branch's DOORS act on, given its own room's name and its
    /// canonical dir: the own room while a claude is in it, else the outside
    /// session holding this branch's claude, else the own room if it merely
    /// exists (a shell waiting - attach reaches it, end room ends it), else
    /// `None`. `dir` is `None` when the branch name failed the path fence.
    ///
    /// ONE derivation for `branch_session` (attach, end, the headless seam)
    /// written against the same pane list `read_branch` computes the card
    /// from, so the door and the card cannot disagree: before ruled B the own
    /// room won whenever it EXISTED (m12), and an empty `baud-` room hid a
    /// live seat from both faces while these doors opened the empty room.
    pub(crate) fn door_session(&self, own: &str, dir: Option<&Path>) -> Option<String> {
        if self.holds_claude(own) {
            return Some(own.to_string());
        }
        if let Some(seat) = dir.and_then(|dir| self.agent_session_in(dir)) {
            return Some(seat);
        }
        self.names.contains(own).then(|| own.to_string())
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
    pub(crate) fn live_agent_sessions(&self, sessions: &[ClaudeSession]) -> Vec<String> {
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
pub(crate) fn scan_rooms() -> RoomScan {
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
pub(crate) fn parse_panes(text: &str) -> RoomScan {
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
        if AGENT_PANE_COMMANDS.contains(&command.trim()) && !path.trim().is_empty() {
            scan.agent_panes
                .push((name.to_string(), PathBuf::from(path.trim())));
        }
    }
    scan
}

/// The live tmux session a branch's doors act on: BAUD's own room while a
/// claude is in it, otherwise the outside session holding this branch's
/// claude, otherwise the own room if it merely exists. `None` means nothing
/// is running for this branch - a launch would create the room, an end has
/// nothing to do. The rule itself is [`RoomScan::door_session`], pinned
/// against a hand-built scan; this is the live-tmux wrapper.
///
/// Ruled B (Patrick, 2026-09-07): a room holding no claude never outranks a
/// live seat. Until then the own room won whenever it existed (m12), which
/// is how an empty `baud-` room blanked both faces on 09-04.
pub(crate) fn branch_session(project: &Project, branch_name: &str) -> Option<String> {
    let own = room_name(project.room_scope().as_deref(), branch_name);
    let scan = scan_rooms();
    // The branch dir is derived HERE, from the seated project - the frontend
    // names a branch, never a path. A name that is not a single directory
    // component is refused rather than resolved: no dir, so no outside seat.
    let fenced = branch_name.is_empty()
        || branch_name.contains(['/', '\\'])
        || branch_name.starts_with('.');
    let canonical = if fenced {
        None
    } else {
        project.fleet_dir.join(branch_name).canonicalize().ok()
    };
    scan.door_session(&own, canonical.as_deref())
}

/// End a branch's session for real - the ONE door that ends one (Patrick
/// ruling 2026-08-10: detach everywhere else). Killing a room that is already
/// gone is the goal state, not an error. Since m12 this reaches the outside
/// session too when the branch has no room of its own: the agent the card
/// shows alive is the agent this button ends, or the operator cannot end it
/// at all (Patrick-caught 2026-08-12, `aipass-aipass`).
#[cfg(feature = "gui")]
#[tauri::command]
pub fn room_kill(
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
pub(crate) fn live_room_in(project: &Project, branch_name: &str) -> Result<String, String> {
    resolve_room(project, branch_name)?
        .ok_or_else(|| format!("no room live for '{branch_name}' - nothing to attach to"))
}

/// The keystroke names `--key` will pass to tmux, and the only ones.
///
/// `send-keys` WITHOUT `-l` interprets its argument, so an unbounded name is an
/// unbounded keystroke. This list is the contract's, exactly - the six the key
/// bar shows plus the ones a stuck agent needs.
pub(crate) const ALLOWED_KEYS: [&str; 14] = [
    "Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "C-c", "C-d", "C-l", "C-u", "BSpace",
    "PageUp", "PageDown",
];

/// Longest literal `--text` will type in one call. Refused rather than
/// trimmed: a caller whose 3000 characters silently became 2000 would believe
/// they had typed a command they did not type.
pub(crate) const TEXT_LIMIT: usize = 2000;

/// Deepest scrollback `--capture-room` will reach above the visible screen.
pub(crate) const LINES_LIMIT: i64 = 2000;

pub(crate) fn key_is_allowed(name: &str) -> bool {
    ALLOWED_KEYS.contains(&name)
}

pub(crate) fn refuse_lines(lines: i64) -> Result<(), String> {
    if !(0..=LINES_LIMIT).contains(&lines) {
        return Err(format!(
            "--lines is {lines}, outside the 0 to {LINES_LIMIT} this door will read - refused rather than clamped, because a caller who asked for 5000 and silently got 2000 would believe they had the whole history"
        ));
    }
    Ok(())
}

pub(crate) fn refuse_text(text: &str) -> Result<(), String> {
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
pub(crate) fn pane_target(room: &str) -> String {
    format!("={room}:")
}

/// The argv for one capture. Split out so the shape tmux is handed can be
/// asserted without a tmux server - the same reason `parse_panes` exists.
pub(crate) fn capture_args(target: &str, lines: i64) -> Vec<String> {
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
pub(crate) fn send_keys_args(target: &str, payload: &SendPayload) -> Vec<String> {
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

pub(crate) fn room_kill_named(room: &str) -> Result<(), String> {
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
pub(crate) fn pane_geometry(target: &str) -> (u16, u16) {
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
