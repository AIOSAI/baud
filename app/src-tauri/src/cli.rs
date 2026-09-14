//! `baud --snapshot` AND FRIENDS - the same reads, with no window.
//!
//! The desktop binary is also a CLI: `/v1/fleet` execs `baud --snapshot` and
//! parses what comes back, so every envelope here is a published interface and
//! not a debugging convenience. Each outcome serializes in full even when it
//! failed - a refusal is a document too - and the exit code agrees with the
//! payload rather than being decided separately.
//!
//! Lifted out of lib.rs by FPLAN-0445 without a line of it changing.

use serde::Serialize;

use crate::*;

/// What the command line asked this process to be.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Invocation {
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
pub(crate) const HEADLESS_FLAGS: [&str; 6] = [
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
pub(crate) fn parse_invocation(args: &[String]) -> Invocation {
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
pub(crate) fn snapshot_project(name: Option<&str>) -> Result<Project, String> {
    select_project(anchor_project()?, name)
}

/// The census half of [`snapshot_project`], split out because it takes the
/// anchor as an argument instead of resolving one.
///
/// That split is the whole CI story: a test can hand this a fixture tree it
/// built itself, while a test aimed at `snapshot_project` can only ever reach
/// the real AIPass root - green on this machine, red on a bare runner. Same
/// lesson as the `resolve_paths` fix in 0d88bc5, same remedy.
pub(crate) fn select_project(anchor: Project, name: Option<&str>) -> Result<Project, String> {
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
pub(crate) fn snapshot_headless(name: Option<&str>) -> FleetSnapshot {
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
pub(crate) fn snapshot_exit_code(snapshot: &FleetSnapshot) -> i32 {
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
    pub(crate) fn failed(branch: &str, project: Option<&str>, error: String) -> Self {
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
pub(crate) fn end_room_headless(branch: &str, project_name: Option<&str>) -> KillOutcome {
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
pub(crate) fn kill_exit_code(outcome: &KillOutcome) -> i32 {
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
    pub(crate) fn failed(branch: &str, project: Option<&str>, error: String) -> Self {
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
    pub(crate) fn failed(branch: &str, project: Option<&str>, error: String) -> Self {
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
pub(crate) fn capture_room_headless(branch: &str, project_name: Option<&str>, lines: i64) -> CaptureOutcome {
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
pub(crate) fn send_room_headless(
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
pub(crate) struct CensusOutcome {
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
pub(crate) fn list_projects_headless() -> CensusOutcome {
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
pub(crate) struct RosterOutcome {
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
pub(crate) fn roster_headless() -> RosterOutcome {
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

pub(crate) fn capture_exit_code(outcome: &CaptureOutcome) -> i32 {
    i32::from(outcome.error.is_some())
}

pub(crate) fn send_exit_code(outcome: &SendOutcome) -> i32 {
    i32::from(outcome.error.is_some())
}

/// The six verbs, one usage line each, under `program` - the name the caller
/// typed. The desktop binary and baud-cli print the same block; only the name
/// differs.
pub fn usage(program: &str) -> String {
    [
        format!("usage: {program} --snapshot [--project <name>]"),
        format!("       {program} --end-room <branch> [--project <name>]"),
        format!("       {program} --capture-room <branch> [--project <name>] [--lines <N>]"),
        format!("       {program} --send-room <branch> [--project <name>] (--text <s> | --key <NAME>)"),
        format!("       {program} --list-projects"),
        format!("       {program} --roster"),
    ]
    .join("\n")
}

/// The name this process was started as, for its own stderr: `baud` for the
/// desktop binary, `baud-cli` for the headless one. `baud` when the OS will not
/// say.
pub fn program_name() -> String {
    std::env::args_os()
        .next()
        .as_deref()
        .map(std::path::Path::new)
        .and_then(std::path::Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or("baud")
        .to_string()
}

/// Run the headless half if the command line asked for it.
///
/// Returns the process exit code, or `None` to mean "carry on and open the
/// window". Errors never produce partial output: the JSON object is
/// serialized whole before a byte reaches stdout.
///
/// Public for baud-cli, which hands it the arguments and exits with its code.
pub fn run_headless(args: &[String]) -> Option<i32> {
    match parse_invocation(args) {
        Invocation::Window => None,
        Invocation::Usage(problem) => {
            let program = program_name();
            eprintln!("{program}: {problem}");
            eprintln!("{}", usage(&program));
            Some(2)
        }
        Invocation::Snapshot { project } => {
            let snapshot = snapshot_headless(project.as_deref());
            match serde_json::to_string(&snapshot) {
                Ok(json) => {
                    println!("{json}");
                    if let Some(error) = &snapshot.error {
                        eprintln!("{}: {error}", program_name());
                    }
                    Some(snapshot_exit_code(&snapshot))
                }
                // Serializing our own struct cannot realistically fail, but
                // claiming success on an empty stdout would be a lie.
                Err(error) => {
                    eprintln!("{}: could not serialize the snapshot: {error}", program_name());
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
pub(crate) fn emit<T: Serialize>(outcome: &T, error: Option<&str>, code: i32) -> Option<i32> {
    match serde_json::to_string(outcome) {
        Ok(json) => {
            println!("{json}");
            if let Some(error) = error {
                eprintln!("{}: {error}", program_name());
            }
            Some(code)
        }
        Err(error) => {
            eprintln!("{}: could not serialize the result: {error}", program_name());
            Some(1)
        }
    }
}
