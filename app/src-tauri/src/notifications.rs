//! The notification feed reader (m10): the bell's backend half.
//!
//! Desktop toasts are retired (Patrick ruling 2026-08-11) - ai_mail appends
//! every notification event to `.aipass/notifications.jsonl` at the project
//! root, and BAUD renders them in the header bell. This module only READS:
//! the feed's single writer is ai_mail, readers never write, and read-state
//! lives on the frontend (localStorage), never in the feed - two BAUD
//! windows must not fight over read flags.
//!
//! The path is composed here from the seated project's root - the frontend
//! names no paths (m4 fence doctrine). A missing feed is a quiet empty list,
//! not an error: fresh installs and projects that never mailed anyone have
//! no feed, and that is fine. Corrupt lines are skipped one by one - a torn
//! trailing write or a truncated first line after the tail seek must never
//! take the whole bell down.

use std::fs;
use std::io::{Read as _, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// One event off the feed. Mirrors the FPLAN-0398 contract line:
/// `{"ts": ISO8601, "kind": mail|wake|dispatch|system, "title", "body", "source"}`.
/// Everything but ts/title defaults, so a lean writer still renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationEvent {
    pub ts: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub source: String,
}

fn default_kind() -> String {
    "system".to_string()
}

/// Where ai_mail writes, relative to the project root (the contract path).
const FEED_RELATIVE: &str = ".aipass/notifications.jsonl";

/// ai_mail trims the feed to a couple hundred lines; this cap is the
/// defensive ceiling for when that trim breaks - the bell reads a tail,
/// never a multi-megabyte file into memory.
const FEED_TAIL_BYTES: u64 = 256 * 1024;

/// The most events one read returns (newest kept).
const FEED_MAX_EVENTS: usize = 200;

/// The bell's poll: newest events from the seated project's feed, oldest
/// first (file order is append order - the frontend reverses for display).
#[tauri::command]
pub fn notifications_read(
    state: tauri::State<'_, crate::ActiveProject>,
) -> Result<Vec<NotificationEvent>, String> {
    Ok(read_feed(&crate::active_project(&state)?.root))
}

pub(crate) fn read_feed(root: &Path) -> Vec<NotificationEvent> {
    let path = root.join(FEED_RELATIVE);
    let Ok(mut file) = fs::File::open(&path) else {
        return Vec::new();
    };

    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    if len > FEED_TAIL_BYTES && file.seek(SeekFrom::End(-(FEED_TAIL_BYTES as i64))).is_err() {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&bytes);
    let mut events: Vec<NotificationEvent> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line.trim()).ok())
        .collect();
    if events.len() > FEED_MAX_EVENTS {
        events.drain(..events.len() - FEED_MAX_EVENTS);
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn feed_dir(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("baud-bell-test-{tag}-{}", std::process::id()));
        fs::create_dir_all(root.join(".aipass")).expect("temp .aipass dir");
        root
    }

    fn write_feed(root: &Path, lines: &[&str]) {
        let mut file = fs::File::create(root.join(FEED_RELATIVE)).expect("feed file");
        for line in lines {
            writeln!(file, "{line}").expect("feed line");
        }
    }

    #[test]
    fn missing_feed_is_a_quiet_empty_list() {
        let root = feed_dir("missing");
        assert!(read_feed(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_contract_lines_in_file_order_and_skips_corrupt_ones() {
        let root = feed_dir("parse");
        write_feed(
            &root,
            &[
                r#"{"ts":"2026-08-11T20:00:00","kind":"mail","title":"Email from @prax","body":"Landed.","source":"prax"}"#,
                "not json at all",
                r#"{"ts":"2026-08-11T20:05:00","kind":"dispatch","title":"@ai_mail completed","body":"Duration: 300s","source":"ai_mail"}"#,
                "",
                r#"{"ts":"2026-08-11T20:06:00","title":"lean writer line"}"#,
            ],
        );

        let events = read_feed(&root);
        assert_eq!(events.len(), 3, "two junk lines skipped, three kept");
        assert_eq!(events[0].kind, "mail");
        assert_eq!(events[1].source, "ai_mail");
        // Missing kind/body/source default rather than killing the line.
        assert_eq!(events[2].kind, "system");
        assert_eq!(events[2].body, "");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn oversized_feed_keeps_only_the_newest_events() {
        let root = feed_dir("cap");
        let lines: Vec<String> = (0..FEED_MAX_EVENTS + 50)
            .map(|i| format!(r#"{{"ts":"2026-08-11T20:00:{i:02}","title":"event {i}"}}"#))
            .collect();
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_feed(&root, &refs);

        let events = read_feed(&root);
        assert_eq!(events.len(), FEED_MAX_EVENTS);
        assert_eq!(
            events.last().expect("newest").title,
            format!("event {}", FEED_MAX_EVENTS + 49),
            "the newest line survives the cap"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
