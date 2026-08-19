//! WHO IS ACTUALLY AWAKE - claude processes, their transcripts, their subagents.
//!
//! Aliveness on a card is not a guess: it is `/proc` for the running processes
//! and the transcript files on disk for what those processes are doing. The two
//! halves are here together because they answer one question between them, and
//! separating them is how a face starts showing a dead agent as live.
//!
//! Lifted out of lib.rs by FPLAN-0445 without a line of it changing.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::*;

/// Classify a `/proc/<pid>/cmdline` buffer (NUL-separated argv).
///
/// Returns `Some(headless)` when argv[0] is a claude binary, `None` otherwise.
/// `headless` means `-p`/`--print` is present - the shape of every dispatched
/// wake (`claude -p ...` / `claude -c -p ...`); an interactive session never
/// carries it.
pub(crate) fn classify_claude_cmdline(cmdline: &[u8]) -> Option<bool> {
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
pub(crate) fn scan_claude_sessions() -> Vec<ClaudeSession> {
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
pub(crate) fn scan_claude_sessions() -> Vec<ClaudeSession> {
    Vec::new()
}

/// Claude Code keeps each directory's conversation transcripts under
/// `~/.claude/projects/<munged>/`, where every non-alphanumeric character of
/// the absolute path becomes '-'. This reproduces that munge.
pub(crate) fn transcript_dir_name(branch_dir: &Path) -> String {
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
pub(crate) const INTERACTIVE_MARKER: &str = "\"type\":\"file-history-snapshot\"";
pub(crate) const MARKER_SCAN_BYTES: u64 = 64 * 1024;

pub(crate) fn is_interactive_transcript(path: &Path) -> bool {
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
pub(crate) fn claude_history(branch_dir: &Path) -> (bool, Option<String>) {
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

pub(crate) fn claude_history_in(transcripts: &Path) -> (bool, Option<String>) {
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
pub(crate) const SUBAGENT_LIVENESS_SECS: u64 = 900;
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
pub(crate) const SUBAGENT_TAIL_BYTES: u64 = 256 * 1024;

/// An async agent writes its own `subagents/agent-<id>.jsonl` continuously
/// while it works and goes quiet when it finishes or dies - there is no
/// persistent "done" record anywhere (the completion notification scrolls out
/// of the parent tail like everything else). A file written within this window
/// counts as running; a finished or crashed agent drops off as the window
/// closes behind it - the same self-heal-by-window doctrine as
/// [`SUBAGENT_LIVENESS_SECS`]. Sized to ride out one long model call, which
/// writes nothing until it returns.
pub(crate) const AGENT_FILE_ACTIVE_SECS: u64 = 180;

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
pub(crate) fn count_inflight_subagents(tail: &str, meta_ids: &std::collections::HashSet<String>) -> u64 {
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
pub(crate) fn async_agents_running(session_dir: &Path) -> (std::collections::HashSet<String>, u64) {
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
pub(crate) fn modified_within(path: &Path, window_secs: u64) -> bool {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|elapsed| elapsed.as_secs() <= window_secs)
}

/// True when any `.jsonl` directly under `dir` was modified within the window.
pub(crate) fn any_jsonl_modified_within(dir: &Path, window_secs: u64) -> bool {
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
pub(crate) fn subagent_count(branch_dir: &Path) -> u64 {
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

pub(crate) fn subagent_count_in(transcripts: &Path) -> u64 {
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
pub(crate) fn read_tail(path: &Path, max_bytes: u64) -> String {
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
