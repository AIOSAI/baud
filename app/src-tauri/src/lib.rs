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

use std::io::Read;
use std::path::{Path, PathBuf};
// The seat's lock (projects.rs), which only the window has.
#[cfg(feature = "gui")]
use std::sync::Mutex;

use serde::Serialize;
#[cfg(feature = "gui")]
use tauri::Manager;

// THE LANES, split out of this file by FPLAN-0445. It held 4013 lines and six
// concerns; each module below carries one of them, moved verbatim. Rust privacy
// does the rest: a child module can already read this file's private items, so
// only what LEFT needed a visibility prefix.
//
// `host_relay`, `memory`, `notifications`, `pty`, `reads`, `screenshot` and
// `settings` serve the window alone - its relay, dials, bell, terminal, reading
// room and capture - so they build only with the gui feature. `cli`, `fleet`, `projects`, `rooms` and
// `sessions` are the reader, which the desktop binary and baud-cli share.
mod cli;
mod fleet;
#[cfg(feature = "gui")]
mod host_relay;
#[cfg(feature = "gui")]
mod memory;
#[cfg(feature = "gui")]
mod notifications;
mod projects;
#[cfg(feature = "gui")]
mod pty;
#[cfg(feature = "gui")]
mod reads;
mod rooms;
#[cfg(feature = "gui")]
mod screenshot;
mod sessions;
#[cfg(feature = "gui")]
mod settings;

// The six lanes are glob-imported straight back, and that is the point: every
// call site in this file, in the tests below, and in each sibling module keeps
// naming these items exactly as it did when they all lived here. A move that
// renames things is not a move.
//
// Nothing outside the tests names a cli item any more - the three baud-cli
// needs are re-exported below - so its glob serves the tests alone.
#[cfg(test)]
use cli::*;
use fleet::*;
use projects::*;
// Likewise reads: run() names its commands by path, so only the window's tests
// below use the glob.
#[cfg(all(test, feature = "gui"))]
use reads::*;
use rooms::*;
use sessions::*;

// baud-cli's way in (src/bin/baud_cli.rs): the headless entry itself, and the
// usage block it prints when handed none of the six verbs.
pub use cli::{program_name, run_headless, usage};

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
    /// `.ai_mail.local/.dispatch.lock` names a process that is ALIVE - a
    /// dispatched agent is working the branch right now. The lock's existence
    /// is not enough (FPLAN-0492): ai_mail reclaims a stale lock only on the
    /// next dispatch, so after a reboot a dead lock kept cards in the
    /// dispatched wheel for hours. See `dispatch_lock_live`.
    pub dispatched: bool,
    /// A live interactive claude session (no `-p`) has its cwd in this branch -
    /// someone is at the wheel.
    pub interactive: bool,
    /// An INTERACTIVE claude transcript exists for this directory - there is a
    /// conversation plain `-c` could continue. Since FPLAN-0448 this is the
    /// FALLBACK door: it steers the resume button only when `resume_id` is
    /// absent.
    pub has_history: bool,
    /// The session the resume door opens interactively via `--resume <id>`:
    /// the branch's own session pointer (`.ai_mail.local/session.json`,
    /// written by dispatch on every wake - FPLAN-0447) when it is valid, else
    /// the newest transcript when only headless dispatch history exists (`-c`
    /// refuses those). `None` when there is no usable pointer and either
    /// interactive history exists (plain `-c` continues it) or there are no
    /// transcripts at all.
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
    /// NOT ALWAYS THE SESSION A DOOR ACTS ON. When
    /// [`own_room_live`](Self::own_room_live) is false the branch's live
    /// claude may be sitting in a session BAUD never made, and
    /// [`outside_room`](Self::outside_room) names it. The resolution is: own
    /// room while a claude is in it, else `outside_room`, else the own room
    /// if it merely exists, else this name to create. That is ruled B
    /// (Patrick, 2026-09-07, ONE ROOM step 2): a room holding no claude never
    /// outranks a live seat. m12 had the own room win whenever it EXISTED,
    /// and an empty `baud-` room hid the live seat from both faces (09-04).
    pub room: String,
    /// A `baud-<branch>` tmux session exists - the agent has a living room
    /// to attach to, whether or not anything is running inside it. Does NOT
    /// by itself decide which session the doors act on; that is
    /// [`own_room_live`](Self::own_room_live).
    pub has_room: bool,
    /// This branch's own room exists AND holds a pane running a claude -
    /// interactive or dispatched-headless alike, the same pane test the
    /// outside-room scan uses. Only while this is true does the own room
    /// silence `outside_room`; when it is false with `has_room` true the room
    /// is a shell waiting, and a live seat elsewhere outranks it (ruled B).
    /// Always false when `has_room` is false.
    pub own_room_live: bool,
    /// A live claude sitting in a tmux session BAUD did NOT create, with its
    /// pane seated in this branch - the boot shim's `aipass-<branch>`, a
    /// `telegram-<branch>` wake, a hand-rolled session. Only ever set when
    /// the branch's own room holds no live claude - absent, or a shell
    /// waiting - so the card knows which session its doors will act on.
    /// `None` is the ordinary case.
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
            own_room_live: false,
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

/// The desktop app: a headless verb answers and exits, anything else opens the
/// window. Only with the gui feature - baud-cli calls [`run_headless`] itself
/// and has no window to open.
#[cfg(feature = "gui")]
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
            fleet::fleet_snapshot,
            fleet::agent_roster,
            projects::list_projects,
            projects::project_switch,
            reads::list_dir,
            reads::read_file_text,
            reads::resolve_paths,
            reads::git_changes,
            reads::git_project_changes,
            reads::git_diff_text,
            rooms::room_kill,
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
            memory::memory_config_push,
            host_relay::host_relay_settings_read,
            host_relay::host_relay_settings_write,
            host_relay::host_api_call
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
    use std::fs;
    use std::process::Command;

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

    #[cfg(feature = "gui")]
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

    #[cfg(feature = "gui")]
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

    #[cfg(feature = "gui")]
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

    /// FPLAN-0492 item 1: the dispatched wheel reads the LOCK PID and requires
    /// it alive, not the lock's existence. ai_mail reclaims a stale lock only
    /// on the next dispatch after its 600 s window, so after a reboot a dead
    /// lock kept cards dispatched for hours. The live lock has four keys
    /// (pid, timestamp, branch, subject) and its pid is the dispatch monitor,
    /// not a claude - the `/proc` claude pass cannot see it, `/proc/<pid>` is
    /// stat'ed directly. Mutation: revert to `.exists()` and the dead-pid,
    /// pid-less and unparseable arms all go red.
    #[test]
    fn dispatched_requires_the_lock_pid_alive() {
        let base = std::env::temp_dir().join(format!("baud-locklive-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let branch = base.join("worker");
        let lock_dir = branch.join(".ai_mail.local");
        fs::create_dir_all(&lock_dir).unwrap();
        let lock = lock_dir.join(".dispatch.lock");
        let quiet = RoomScan::default();
        let dispatched = || read_branch(&branch, "worker".into(), "AIPASS", &[], &quiet, None).dispatched;

        // No lock at all: not dispatched, as before.
        assert!(!dispatched(), "no lock must read not dispatched");

        // A live pid - our own - in the lock's real four-key shape.
        fs::write(
            &lock,
            format!(
                r#"{{"pid": {}, "timestamp": "2026-09-07T19:35:00", "branch": "{}", "subject": "daemon wake"}}"#,
                std::process::id(),
                branch.display()
            ),
        )
        .unwrap();
        assert!(dispatched(), "a lock naming a live pid reads dispatched");

        // A dead pid: spawn a child and reap it - never a made-up number.
        let mut child = Command::new("true").spawn().expect("spawn `true`");
        let pid = child.id();
        child.wait().expect("reap the child");
        // ARMED: the pid is really gone before the claim below is made. If
        // this fails the pin is not measuring death (zombie, pid reuse).
        assert!(
            !std::path::Path::new("/proc").join(pid.to_string()).exists(),
            "reaped child {pid} is still in /proc - the dead-pid pin is not armed"
        );
        fs::write(
            &lock,
            format!(r#"{{"pid": {pid}, "timestamp": "2026-09-07T19:35:00", "branch": "x"}}"#),
        )
        .unwrap();
        assert!(!dispatched(), "a lock naming a dead pid reads not dispatched");

        // No pid key at all.
        fs::write(&lock, r#"{"timestamp": "2026-09-07T19:35:00", "branch": "x"}"#).unwrap();
        assert!(!dispatched(), "a lock with no pid reads not dispatched");
        // Unparseable JSON.
        fs::write(&lock, "{not json").unwrap();
        assert!(!dispatched(), "an unparseable lock reads not dispatched");
        // Pid 0 is never a process, whatever /proc says about it.
        fs::write(&lock, r#"{"pid": 0}"#).unwrap();
        assert!(!dispatched(), "pid 0 reads not dispatched");

        let _ = fs::remove_dir_all(&base);
    }

    /// FPLAN-0492 item 2, ruled B (Patrick, 2026-09-07, ONE ROOM step 2): a
    /// room holding no claude never outranks a live seat. The card's
    /// `outside_room` and the doors' `door_session` are read against the SAME
    /// hand-built scan so the two cannot drift apart. Mutation: restore the
    /// `if has_room { None }` arm and the empty-room-with-a-seat case goes red.
    #[test]
    fn an_empty_own_room_never_hides_a_live_seat() {
        let base = std::env::temp_dir().join(format!("baud-ruledb-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let branch = base.join("worker");
        fs::create_dir_all(&branch).unwrap();
        let canonical = branch.canonicalize().unwrap();
        let own = room_name(None, "worker");
        let seat = "aipass-worker".to_string();
        let row = |scan: &RoomScan| read_branch(&branch, "worker".into(), "AIPASS", &[], scan, None);

        // Own room LIVE (a claude in it) and a seat elsewhere: the room wins.
        let mut scan = RoomScan::default();
        scan.names.insert(own.clone());
        scan.names.insert(seat.clone());
        scan.agent_panes.push((own.clone(), canonical.clone()));
        scan.agent_panes.push((seat.clone(), canonical.clone()));
        let card = row(&scan);
        assert!(card.has_room && card.own_room_live);
        assert_eq!(card.outside_room, None, "a live own room silences the seat");
        assert_eq!(scan.door_session(&own, Some(&canonical)).as_deref(), Some(own.as_str()));

        // Own room exists but EMPTY, live seat elsewhere: the seat is named,
        // the new field says why, and the doors go to the seat too.
        let mut scan = RoomScan::default();
        scan.names.insert(own.clone());
        scan.names.insert(seat.clone());
        scan.agent_panes.push((seat.clone(), canonical.clone()));
        let card = row(&scan);
        assert!(card.has_room, "the empty room still exists");
        assert!(!card.own_room_live, "an empty room holds no claude");
        assert_eq!(card.outside_room.as_deref(), Some("aipass-worker"), "the seat is not hidden");
        assert_eq!(scan.door_session(&own, Some(&canonical)).as_deref(), Some("aipass-worker"));

        // No own room, live seat elsewhere: today's behaviour, unchanged.
        let mut scan = RoomScan::default();
        scan.names.insert(seat.clone());
        scan.agent_panes.push((seat.clone(), canonical.clone()));
        let card = row(&scan);
        assert!(!card.has_room && !card.own_room_live);
        assert_eq!(card.outside_room.as_deref(), Some("aipass-worker"));
        assert_eq!(scan.door_session(&own, Some(&canonical)).as_deref(), Some("aipass-worker"));

        // Own room exists, empty, NO seat: nothing outside, and the doors
        // still reach the waiting shell.
        let mut scan = RoomScan::default();
        scan.names.insert(own.clone());
        let card = row(&scan);
        assert!(card.has_room && !card.own_room_live);
        assert_eq!(card.outside_room, None);
        assert_eq!(scan.door_session(&own, Some(&canonical)).as_deref(), Some(own.as_str()));

        // No room and no seat: None everywhere, and the fenced-name door
        // (no dir) has nothing to find either.
        let scan = RoomScan::default();
        let card = row(&scan);
        assert!(!card.has_room && !card.own_room_live);
        assert_eq!(card.outside_room, None);
        assert_eq!(scan.door_session(&own, Some(&canonical)), None);
        assert_eq!(scan.door_session(&own, None), None);

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

    #[cfg(feature = "gui")]
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
    #[cfg(feature = "gui")]
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

    #[cfg(feature = "gui")]
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

    #[cfg(feature = "gui")]
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
