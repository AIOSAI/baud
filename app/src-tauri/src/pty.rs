//! The operator's terminal.
//!
//! Milestone 2 gives BAUD one interactive surface: a real PTY running the
//! user's own login shell, at the user's own privileges, in the AIPass root.
//! It is the operator's hands - the same thing their terminal emulator would
//! give them - and nothing about it is automation. BAUD itself still does not
//! decide to run anything; every byte written to this shell was typed by a
//! human, or is the one visible command line a card's launch button writes on
//! the operator's explicit click.
//!
//! Three details are load-bearing:
//!
//! 1. **A pty, not a pipe.** Job control, line discipline, `$TERM` behaviour,
//!    and interactive programs (`less`, `vim`, `claude`) all need a terminal
//!    device on the other end.
//! 2. **The slave is dropped after spawn.** Holding a slave handle open keeps
//!    the master readable forever, so the reader thread would never see EOF and
//!    the frontend would never learn that the shell exited.
//! 3. **Teardown signals the process group, never the shell alone.** The shell
//!    is spawned through `setsid()` (portable-pty does this so the pty can be
//!    its controlling terminal), which makes it a session and process-group
//!    leader with `PGID == PID`. Signalling `-PID` reaches every job it started;
//!    signalling the bare PID orphans them, which is the classic way a terminal
//!    emulator leaks background processes.
//!
//! Milestone 6 (rooms): when a spawn names a room, the process on the pty is
//! not a shell but a tmux CLIENT - `tmux new-session -A` attaching to (or
//! creating) the branch's persistent session. Everything above still holds,
//! with one beautiful consequence: the SIGHUP teardown that used to kill the
//! agent now merely kills the client, which IS a detach. The agent, its
//! claude, and its jobs live in the tmux server's process tree, not ours -
//! switching cards and closing BAUD stop being lethal by construction. The
//! explicit `room_kill` command (lib.rs) is the only door that actually ends
//! a session.
//!
//! Milestone 9 (monitor panes): a second KIND of session - `monitor_create`
//! runs a read-only observer (`drone @prax monitor run ...`) on its own pty.
//! Tier-0 doctrine (DPLAN-0284): keyword-filtering what can be typed is
//! theater, so the enforcement is that nothing can be typed AT ALL. The
//! session is flagged `read_only` and `pty_write` refuses it - the no-stdin
//! line holds in the backend even if some future frontend wires a keyboard
//! by mistake. The command itself is backend-chosen from a fixed shape; the
//! frontend picks a target from the fleet, never a command line.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtyPair, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

/// PTY output is read in 4KB bites - big enough that a burst of output is a
/// handful of IPC messages, small enough that the first prompt appears at once.
const READ_BUFFER_BYTES: usize = 4096;

/// The shell used when `$SHELL` is missing or empty.
const FALLBACK_SHELL: &str = "/bin/bash";

/// How long a signalled process group gets to die politely before SIGKILL.
const KILL_GRACE: Duration = Duration::from_millis(400);

/// How long to wait for the reader thread to notice EOF and finish.
const REAP_GRACE: Duration = Duration::from_millis(300);

/// Poll step for both waits above.
const POLL_STEP: Duration = Duration::from_millis(10);

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// What `pty_create` hands back: the stream id, and whether a named room was
/// CREATED by this spawn or merely attached to. The frontend types the staged
/// claude command only into a room it just created (or one with no live
/// claude) - typing into an existing session would land in claude's input box.
#[derive(Debug, Clone, Serialize)]
pub struct SpawnResult {
    pub id: String,
    pub created: bool,
    /// The tmux session this pty is a window into - BAUD's own room, or the
    /// outside session the branch's claude was already living in (m12).
    /// `None` for the scratch shell and the help terminals, which are no
    /// room at all. The frontend says this name out loud on the end-room
    /// button: the operator should never have to guess what a kill will hit.
    pub room: Option<String>,
}

/// Everything the frontend hears from a session, over its own channel.
///
/// Output is base64 because a 4KB read can land in the middle of a multi-byte
/// UTF-8 sequence. Lossy string conversion would replace the split character
/// with `U+FFFD` and corrupt the stream; raw bytes let xterm's own decoder
/// carry the partial sequence across chunks.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyEvent {
    /// One chunk of shell output.
    Data { session: String, base64: String },
    /// The shell is gone. Terminal state - no further data will arrive.
    Exit { session: String },
}

/// One live shell.
struct Session {
    /// Kept for resize; dropping it closes the master fd.
    master: Box<dyn MasterPty + Send>,
    /// Keystrokes go in here.
    writer: Box<dyn Write + Send>,
    /// The shell process itself.
    child: Box<dyn Child + Send + Sync>,
    /// The shell's OS pid, which is also its process-group id (see module docs).
    pid: Option<u32>,
    /// The thread pumping master -> frontend. Joined on teardown.
    reader: Option<JoinHandle<()>>,
    /// A tier-0 monitor pane: `pty_write` refuses it (see module docs).
    read_only: bool,
}

/// All live shells, keyed by session id.
///
/// One session is the expected case - the terminal in the middle of the window.
/// A map keeps the shape general without costing anything today.
#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, Session>>,
}

impl PtyRegistry {
    /// A panic elsewhere must not wedge the operator's terminal, so a poisoned
    /// lock is recovered rather than propagated.
    fn sessions(&self) -> MutexGuard<'_, HashMap<String, Session>> {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn next_session_id() -> String {
    format!("pty-{}", NEXT_SESSION.fetch_add(1, Ordering::Relaxed))
}

/// The user's shell, or a sane fallback. Never guesses beyond that.
fn user_shell() -> String {
    match std::env::var("SHELL") {
        Ok(shell) if !shell.trim().is_empty() => shell,
        _ => FALLBACK_SHELL.to_string(),
    }
}

// ---------------------------------------------------------------- base64

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard RFC 4648 base64 with padding. Hand-rolled to keep the dependency
/// list at "one crate for the pty" - the alphabet is not a moving target.
fn base64_encode(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = u32::from(chunk[0]);
        let second = u32::from(chunk.get(1).copied().unwrap_or(0));
        let third = u32::from(chunk.get(2).copied().unwrap_or(0));
        let triple = (first << 16) | (second << 8) | third;

        let symbol = |shift: u32| BASE64_ALPHABET[((triple >> shift) & 63) as usize] as char;

        encoded.push(symbol(18));
        encoded.push(symbol(12));
        encoded.push(if chunk.len() > 1 { symbol(6) } else { '=' });
        encoded.push(if chunk.len() > 2 { symbol(0) } else { '=' });
    }

    encoded
}

// ------------------------------------------------------------- teardown

/// Signal an entire process group. Unix only; see the module docs for why the
/// group and not the pid.
#[cfg(unix)]
fn signal_group(pid: u32, signal: i32) {
    let group = pid as libc::pid_t;
    if group <= 0 {
        return;
    }
    // Safety: killpg with a group id we own. A dead group returns ESRCH, which
    // is exactly the outcome we want anyway.
    let _ = unsafe { libc::killpg(group, signal) };
}

/// Wait up to `grace` for the child to report an exit. Returns whether it did.
fn wait_for_exit(child: &mut Box<dyn Child + Send + Sync>, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            // Unknowable state - escalating further would not help.
            Err(_) => return true,
            Ok(None) => {}
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(POLL_STEP);
    }
}

/// Kill one session and reclaim everything it held.
fn terminate(mut session: Session) {
    #[cfg(unix)]
    {
        match session.pid {
            Some(pid) => {
                // SIGHUP is what closing a terminal window sends: shells and
                // well-behaved jobs clean up after themselves.
                signal_group(pid, libc::SIGHUP);
                if !wait_for_exit(&mut session.child, KILL_GRACE) {
                    signal_group(pid, libc::SIGKILL);
                    let _ = wait_for_exit(&mut session.child, KILL_GRACE);
                }
            }
            // No pid means no group to signal; fall back to the child itself.
            None => {
                let _ = session.child.kill();
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = session.child.kill();
    }

    // Reap, or the shell lingers as a zombie for the life of the app.
    let _ = session.child.wait();

    // Close our ends of the pty. With the slave already gone and the process
    // group dead, the reader thread's next read returns EOF.
    drop(session.writer);
    drop(session.master);

    if let Some(handle) = session.reader.take() {
        // Bounded reap: a process that escaped the group (its own setsid) could
        // still hold the slave open, and a blind join() would hang the caller.
        let deadline = Instant::now() + REAP_GRACE;
        while !handle.is_finished() && Instant::now() < deadline {
            std::thread::sleep(POLL_STEP);
        }
        if handle.is_finished() {
            let _ = handle.join();
        }
        // Otherwise the thread stays detached and exits on its own EOF.
    }
}

/// Kill every live session. Called when the window is destroyed and again on
/// process exit, so closing BAUD never leaves a shell running behind it.
pub fn shutdown(registry: &PtyRegistry) {
    let sessions: Vec<Session> = registry
        .sessions()
        .drain()
        .map(|(_, session)| session)
        .collect();

    for session in sessions {
        terminate(session);
    }
}

// ------------------------------------------------------------- commands

/// Does this room already exist on the tmux server? No server = no room.
fn room_exists(room: &str) -> bool {
    std::process::Command::new("tmux")
        // `=` pins an exact name; without it tmux prefix-matches targets.
        .args(["has-session", "-t", &format!("={room}")])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Open a terminal and start streaming it.
///
/// With `room` set, the pty runs a tmux client attached to the branch's
/// persistent session (created on first visit, `-c cwd`); without it, the
/// operator's plain login shell in the AIPass root - the scratch terminal.
#[tauri::command(async)]
// Eight arguments, one over the lint. A tauri command's parameters ARE its
// wire format - they are deserialized one-for-one from the frontend's call, so
// grouping them into a struct would not reduce what crosses the boundary, it
// would just add a type whose only job is to satisfy a heuristic.
#[allow(clippy::too_many_arguments)]
pub fn pty_create(
    cols: u16,
    rows: u16,
    room: Option<String>,
    cwd: Option<String>,
    project: Option<String>,
    on_data: Channel<PtyEvent>,
    registry: tauri::State<'_, PtyRegistry>,
    seat: tauri::State<'_, crate::ActiveProject>,
) -> Result<SpawnResult, String> {
    // Same resolution the fleet scan uses - the shell opens where the fleet
    // is seated, and a room name gets the same project scope the card's
    // badge was computed with. A roster card names its OWN project instead,
    // because a room name carries its project: resolving `devpulse` under the
    // seat's scope would miss `baud-devpulse` and create a second, empty room
    // beside the agent the operator was trying to reach.
    let project = crate::project_named(project.as_deref(), &seat)?;
    let root = project.root.clone();

    let size = PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = native_pty_system()
        .openpty(size)
        .map_err(|err| format!("could not open a pty: {err}"))?;

    let shell = user_shell();

    // Resolve through the same door the fleet scan and `room_kill` use, so
    // the session the client attaches to is exactly the one the card's badge
    // was computed from: BAUD's own room when it exists, the branch's outside
    // session when it does not (m12), and BAUD's own name to CREATE when
    // nothing is running there. `new-session -A` covers both halves - it
    // attaches to a session of that name, whoever made it, or creates it.
    let scope = project.room_scope();
    let room = room.map(|name| {
        crate::branch_session(&project, &name)
            .unwrap_or_else(|| crate::room_name(scope.as_deref(), &name))
    });
    let created = match &room {
        Some(name) => !room_exists(name),
        None => true,
    };

    let mut command = match &room {
        Some(name) => {
            // The room's window: a tmux client. `-A` attaches or creates in
            // one verb; `-c` seats a NEW session in the branch dir (ignored on
            // attach); mouse on so the wheel scrolls history like any
            // terminal. The chained set-option is idempotent across attaches.
            let start_dir = cwd.as_deref().unwrap_or_else(|| root.to_str().unwrap_or("."));
            let mut tmux = CommandBuilder::new("tmux");
            tmux.args([
                "new-session",
                "-A",
                "-s",
                name,
                "-c",
                start_dir,
                ";",
                "set-option",
                "mouse",
                "on",
            ]);
            tmux
        }
        // `new_default_prog` is portable-pty's login-shell path: it runs
        // `$SHELL` with argv[0] set to `-<name>`, the convention that tells
        // the shell to read the login profile. Setting SHELL on the builder
        // first is what makes it pick our resolved shell (and our fallback)
        // rather than probing.
        None => CommandBuilder::new_default_prog(),
    };
    command.env("SHELL", &shell);
    command.env("TERM", "xterm-256color");
    // Where a room-less shell opens: the caller's stated dir (the help
    // button seats its inquiry terminal in the branch, m9 phase 4), or the
    // project root - the scratch shell's home. Rooms pass cwd to tmux above.
    match &cwd {
        Some(dir) if room.is_none() => command.cwd(dir),
        _ => command.cwd(&root),
    };

    let child = pair.slave.spawn_command(command).map_err(|err| {
        let what = if room.is_some() { "tmux (rooms need it installed)" } else { &shell };
        format!("could not start {what}: {err}")
    })?;

    let id = stream_session(pair, child, on_data, &registry, false)?;

    Ok(SpawnResult { id, created, room })
}

/// Wire a freshly spawned pty into the registry: release the slave, start
/// the reader thread pumping master -> frontend, file the session under a
/// new id. Shared by the operator shell and the monitor panes - the only
/// difference between the two kinds is `read_only`.
fn stream_session(
    pair: PtyPair,
    child: Box<dyn Child + Send + Sync>,
    on_data: Channel<PtyEvent>,
    registry: &PtyRegistry,
    read_only: bool,
) -> Result<String, String> {
    // Release the slave now that the child owns it: while we hold a handle the
    // master never reports EOF, so we would never notice the process exiting.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("could not read from the pty: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("could not write to the pty: {err}"))?;

    let pid = child.process_id();
    let id = next_session_id();

    let stream_id = id.clone();
    let reader_thread = std::thread::spawn(move || {
        let mut buffer = [0u8; READ_BUFFER_BYTES];
        loop {
            match reader.read(&mut buffer) {
                // EOF: every slave handle is closed, so the process is gone.
                Ok(0) => break,
                Ok(count) => {
                    let event = PtyEvent::Data {
                        session: stream_id.clone(),
                        base64: base64_encode(&buffer[..count]),
                    };
                    // A closed channel means the window went away first.
                    if on_data.send(event).is_err() {
                        break;
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }

        let _ = on_data.send(PtyEvent::Exit { session: stream_id });
    });

    registry.sessions().insert(
        id.clone(),
        Session {
            master: pair.master,
            writer,
            child,
            pid,
            reader: Some(reader_thread),
            read_only,
        },
    );

    Ok(id)
}

/// Charset fence for a monitor target: a branch list (`seedgo,cli`) or the
/// `commons` feed keyword. Anything outside it is refused - the frontend
/// picks targets off the fleet snapshot, it never composes command lines.
fn valid_monitor_target(target: &str) -> bool {
    !target.is_empty()
        && target.chars().all(|ch| {
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '_' | '-' | ',')
        })
}

/// Open a tier-0 monitor pane: `drone @prax monitor run [target]` on its own
/// pty, streamed like any session but flagged read-only (m9, see module
/// docs). No target = mission control, all branches; `commons` = the live
/// social feed; a branch list scopes to those branches (the per-card door).
///
/// The command runs through the operator's login shell (`-l -c`) so `drone`
/// resolves from the same PATH their own terminal would use, seated in the
/// project root - the same place the scratch shell opens.
#[tauri::command(async)]
pub fn monitor_create(
    cols: u16,
    rows: u16,
    target: Option<String>,
    on_data: Channel<PtyEvent>,
    registry: tauri::State<'_, PtyRegistry>,
    seat: tauri::State<'_, crate::ActiveProject>,
) -> Result<String, String> {
    let project = crate::active_project(&seat)?;

    if let Some(name) = &target {
        if !valid_monitor_target(name) {
            return Err(format!("not a monitor target: '{name}'"));
        }
    }

    let size = PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = native_pty_system()
        .openpty(size)
        .map_err(|err| format!("could not open a pty: {err}"))?;

    let shell = user_shell();
    let monitor = match &target {
        Some(name) => format!("exec drone @prax monitor run {name}"),
        None => "exec drone @prax monitor run".to_string(),
    };

    let mut command = CommandBuilder::new(&shell);
    command.args(["-l", "-c", &monitor]);
    command.env("SHELL", &shell);
    command.env("TERM", "xterm-256color");
    command.cwd(&project.root);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| format!("could not start the monitor: {err}"))?;

    stream_session(pair, child, on_data, &registry, true)
}

/// Feed keystrokes to a shell.
#[tauri::command(async)]
pub fn pty_write(
    id: String,
    data: String,
    registry: tauri::State<'_, PtyRegistry>,
) -> Result<(), String> {
    let mut sessions = registry.sessions();
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("no live terminal session '{id}'"))?;

    // The tier-0 line: a monitor pane has no keyboard, even for a caller
    // that found its session id. Refusal here is what makes the frontend's
    // missing stdin wiring a fact rather than a convention.
    if session.read_only {
        return Err(format!("'{id}' is a read-only monitor pane - nothing types into it"));
    }

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|err| format!("could not write to terminal '{id}': {err}"))?;
    session
        .writer
        .flush()
        .map_err(|err| format!("could not flush terminal '{id}': {err}"))
}

/// Tell the shell how big its window is now.
#[tauri::command(async)]
pub fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    registry: tauri::State<'_, PtyRegistry>,
) -> Result<(), String> {
    let sessions = registry.sessions();
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("no live terminal session '{id}'"))?;

    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("could not resize terminal '{id}': {err}"))
}

/// End what is ON the pty. For a plain shell that is the shell and its jobs;
/// for a room that is only the tmux CLIENT - the session survives, so this is
/// a detach. Idempotent: killing one that already exited is a no-op.
#[tauri::command(async)]
pub fn pty_kill(id: String, registry: tauri::State<'_, PtyRegistry>) -> Result<(), String> {
    // Remove first, then do the blocking work outside the lock.
    let session = registry.sessions().remove(&id);

    if let Some(session) = session {
        terminate(session);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, valid_monitor_target};

    #[test]
    fn monitor_targets_are_branch_lists_or_commons() {
        assert!(valid_monitor_target("commons"));
        assert!(valid_monitor_target("seedgo"));
        assert!(valid_monitor_target("seedgo,cli,ai_mail"));
        assert!(valid_monitor_target("vera-studio"));
    }

    #[test]
    fn monitor_target_fence_refuses_command_shapes() {
        // Anything that could smuggle shell syntax past the fixed command.
        assert!(!valid_monitor_target(""));
        assert!(!valid_monitor_target("seedgo; rm -rf /"));
        assert!(!valid_monitor_target("$(whoami)"));
        assert!(!valid_monitor_target("seedgo cli"));
        assert!(!valid_monitor_target("SEEDGO"));
        assert!(!valid_monitor_target("../etc"));
        assert!(!valid_monitor_target("run --relay"));
    }

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_survives_a_split_utf8_sequence() {
        // The two halves of a multi-byte character must round-trip as bytes.
        let bytes = "é".as_bytes();
        assert_eq!(base64_encode(&bytes[..1]), "ww==");
        assert_eq!(base64_encode(&bytes[1..]), "qQ==");
    }
}
