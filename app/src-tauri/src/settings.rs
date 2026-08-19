//! Settings (m11): the first surface in this codebase that WRITES operator
//! config, and the doctrine follows from that single fact.
//!
//! Two files, both composed here from the seated project - the frontend names
//! an agent, never a path (m4 fence doctrine): claude's own
//! `<branch>/.claude/settings.local.json`, and BAUD's
//! `<project root>/.aipass/baud.settings.json`.
//!
//! The agent file is NOT ours. Operators keep permission blocks, MCP server
//! lists, hooks and env in it, and claude reads it every launch - so a write
//! here is surgical by construction: parse the existing document, touch only
//! the three keys this module owns, hand every other key back untouched.
//! Losing a deny-rule to a settings toggle is the worst bug this file could
//! ship, so the failure mode is refusal: a file that does not parse as a JSON
//! object errors out and NOTHING is written. Overwriting what we cannot read
//! is never the safer choice.
//!
//! Writes land through a temp file and a rename - claude may be reading the
//! file at any instant, and rename is the only way it never sees a half-file.
//!
//! Model strings pass through opaque. Which model ids exist is claude's
//! business and it changes without us; a backend that validated them would
//! start refusing valid models the week after it shipped.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// Where claude reads a branch's local settings, relative to the branch dir.
const AGENT_SETTINGS_RELATIVE: &str = ".claude/settings.local.json";

/// BAUD's own per-project settings, beside the notification feed.
const BAUD_SETTINGS_RELATIVE: &str = ".aipass/baud.settings.json";

/// AIPass's hook-sound mute flag, in the OS temp dir: the file EXISTING means
/// MUTED (@hooks `apps/sound.py`, `is_muted()` = the flag exists; its toggle
/// touches and unlinks exactly this path). BAUD is a second hand on the same
/// switch, so the flag file stays the single source of truth - nothing about
/// hook sounds is mirrored into baud.settings.json, where it would drift the
/// moment anything else flipped it. Living in the temp dir, it resets on
/// reboot, and that is the flag's own design, not ours to fix.
const HOOKS_MUTE_FLAG: &str = "aipass-hooks-muted";

/// The only three keys [`agent_settings_write`] may create, change, or
/// remove. Spelled as claude spells them on disk (camelCase), not as the wire
/// struct spells them.
const KEY_MODEL: &str = "model";
const KEY_AUTO_COMPACT_ENABLED: &str = "autoCompactEnabled";
const KEY_AUTO_COMPACT_WINDOW: &str = "autoCompactWindow";

/// What the settings panel shows for one agent. Every field is `None` when
/// the key is absent - "unset, claude decides" is a real state and must not
/// render as a value the operator never chose.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct AgentSettings {
    pub model: Option<String>,
    pub auto_compact_enabled: Option<bool>,
    pub auto_compact_window: Option<u64>,
}

/// The patch shape: three-state per field, so "leave it alone" and "unset it"
/// can never be confused.
///
/// - field ABSENT from the JSON (`undefined` in the webview) -> `None`: not
///   mentioned, not touched.
/// - field explicitly `null` -> `Some(None)`: REMOVE the key.
/// - field with a value -> `Some(Some(v))`: set the key.
///
/// Wire names are snake_case, matching [`AgentSettings`] and the rest of the
/// frontend's mirrors; the on-disk keys stay claude's camelCase.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct AgentSettingsPatch {
    #[serde(default, deserialize_with = "explicit")]
    pub model: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit")]
    pub auto_compact_enabled: Option<Option<bool>>,
    #[serde(default, deserialize_with = "explicit")]
    pub auto_compact_window: Option<Option<u64>>,
}

/// Distinguish "present and null" from "absent" - plain `Option` collapses
/// both to `None`, which is exactly the distinction the patch is built on.
fn explicit<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::deserialize(deserializer).map(Some)
}

/// Uniquifies temp file names within this process.
static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// The branch directory behind a card, resolved exactly the way the fleet
/// scan resolved it in the first place: a directory entry of the seated
/// project's fleet dir. The frontend hands over a NAME - the same name the
/// snapshot gave it and the same door `room_kill` uses - so no settings write
/// can be steered at a path outside the fleet.
fn branch_dir(project: &crate::Project, agent: &str) -> Result<PathBuf, String> {
    let mut components = Path::new(agent).components();
    let is_bare_name = matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none();
    if !is_bare_name {
        return Err(format!("'{agent}' is not a branch name"));
    }

    let dir = project.fleet_dir.join(agent);
    if !dir.is_dir() {
        return Err(format!("no branch named '{agent}' in the seated project"));
    }
    Ok(dir)
}

/// A settings file as an object. Missing (or empty) reads as `{}` - a fresh
/// branch has no settings and that is not a fault. Anything that exists but
/// does not parse as a JSON object is an ERROR, for readers as much as
/// writers: showing empty fields for a file that actually sets values is a
/// lie, and the write path must never treat unreadable as blank.
///
/// THE LINE ABOVE WAS THE DOCTRINE AND NOT THE CODE until 2026-08-18. Every
/// read error - a permission bit, a mount that went away, a directory in the
/// file's place - answered `{}`, so the gear rendered every dial at absent and
/// the very next patch wrote a fresh three-key document over an operator's
/// permission rules. Silently, because nothing in that chain had an error to
/// report. @seedgo found it by cross-reading this file against @api's python
/// mirror of it, which had been hardened against exactly this and whose
/// reasoning is quoted in its own `read_object`.
///
/// So the split is by ERROR KIND, and only one kind reads blank:
///
/// - `NotFound` - nothing is there. A fresh branch, and not a fault.
/// - everything else - something IS there and this process could not read it.
///   The read fails, so the write that would have followed never happens.
///
/// One divergence from the python mirror is deliberate and reported rather
/// than closed: it also reads `NotADirectoryError` as blank (a parent
/// component that is a file, so the settings file genuinely cannot exist).
/// `io::ErrorKind::NotADirectory` needs Rust 1.83 and this crate's MSRV is
/// 1.77.2, so expressing it here means an errno match or an MSRV bump -
/// neither of which belongs in a bug fix. Today that case refuses on this
/// side, which is the safe direction to be wrong in.
pub(crate) fn read_object(path: &Path) -> Result<Map<String, Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(err) => {
            return Err(format!(
                "could not read '{}' ({err}) - refusing to touch it",
                path.display()
            ))
        }
    };
    if raw.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(document)) => Ok(document),
        Ok(_) => Err(format!(
            "'{}' is not a JSON object - refusing to touch it",
            path.display()
        )),
        Err(err) => Err(format!(
            "'{}' is not valid JSON ({err}) - refusing to touch it",
            path.display()
        )),
    }
}

/// Replace a settings file in one step: temp file in the SAME directory (so
/// the rename stays on one filesystem and is therefore atomic), then rename
/// over. A reader either sees the old file whole or the new one whole.
///
/// Keys come out in FILE order: serde_json is built with `preserve_order`
/// (m13), so a one-key change no longer reshuffles a document somebody else
/// wrote. One representational detail survives that: a non-ASCII character
/// escaped as `\uXXXX` in the original is rewritten as literal UTF-8. The
/// decoded string is identical - only its spelling on disk changes.
pub(crate) fn write_atomically(path: &Path, document: &Value) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("'{}' has no parent directory", path.display()))?;
    fs::create_dir_all(dir)
        .map_err(|err| format!("could not create '{}': {err}", dir.display()))?;

    let mut text = serde_json::to_string_pretty(document)
        .map_err(|err| format!("could not serialize settings: {err}"))?;
    text.push('\n');

    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "settings".to_string());
    let temp = dir.join(format!(
        ".{name}.baud-{}-{}.tmp",
        std::process::id(),
        WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));

    fs::write(&temp, text).map_err(|err| format!("could not write '{}': {err}", temp.display()))?;
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("could not replace '{}': {err}", path.display())
    })
}

/// The three owned keys, read out of a settings document. A key with the
/// wrong type reads as unset rather than as an error - the panel then simply
/// offers to set it, which is the honest repair.
fn agent_settings_in(document: &Map<String, Value>) -> AgentSettings {
    AgentSettings {
        model: document
            .get(KEY_MODEL)
            .and_then(Value::as_str)
            .map(str::to_owned),
        auto_compact_enabled: document.get(KEY_AUTO_COMPACT_ENABLED).and_then(Value::as_bool),
        auto_compact_window: document.get(KEY_AUTO_COMPACT_WINDOW).and_then(Value::as_u64),
    }
}

fn set_or_remove(document: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            document.insert(key.to_string(), value);
        }
        None => {
            document.remove(key);
        }
    }
}

/// Apply the patch in place. Only the three owned keys are ever named here -
/// this function is the whole reason unrelated operator config survives.
fn apply_agent_patch(document: &mut Map<String, Value>, patch: &AgentSettingsPatch) {
    if let Some(model) = patch.model.clone() {
        set_or_remove(document, KEY_MODEL, model.map(Value::from));
    }
    if let Some(enabled) = patch.auto_compact_enabled {
        set_or_remove(document, KEY_AUTO_COMPACT_ENABLED, enabled.map(Value::from));
    }
    if let Some(window) = patch.auto_compact_window {
        set_or_remove(document, KEY_AUTO_COMPACT_WINDOW, window.map(Value::from));
    }
}

fn read_agent_settings_at(path: &Path) -> Result<AgentSettings, String> {
    Ok(agent_settings_in(&read_object(path)?))
}

fn write_agent_settings_at(path: &Path, patch: &AgentSettingsPatch) -> Result<AgentSettings, String> {
    // Read-then-error-then-write: the parse failure above returns before a
    // single byte is written, so a corrupt file stays exactly as it was.
    let mut document = read_object(path)?;
    apply_agent_patch(&mut document, patch);
    let settings = agent_settings_in(&document);
    write_atomically(path, &Value::Object(document))?;
    Ok(settings)
}

fn merge_shallow(document: &mut Map<String, Value>, patch: Map<String, Value>) {
    // Top level only: a nested object in the patch REPLACES its counterpart
    // rather than being merged into it, so a caller can always say exactly
    // what a subtree should become.
    for (key, value) in patch {
        set_or_remove(document, &key, (!value.is_null()).then_some(value));
    }
}

fn write_baud_settings_at(path: &Path, patch: Value) -> Result<Value, String> {
    let Value::Object(patch) = patch else {
        return Err("the baud settings patch must be a JSON object".to_string());
    };
    let mut document = read_object(path)?;
    merge_shallow(&mut document, patch);
    let document = Value::Object(document);
    write_atomically(path, &document)?;
    Ok(document)
}

/// One agent's three settings, or all-`None` when it has no settings file.
#[tauri::command]
pub fn agent_settings_read(
    agent: String,
    state: tauri::State<'_, crate::ActiveProject>,
) -> Result<AgentSettings, String> {
    let dir = branch_dir(&crate::active_project(&state)?, &agent)?;
    read_agent_settings_at(&dir.join(AGENT_SETTINGS_RELATIVE))
}

/// Patch one agent's settings, preserving every key BAUD does not own.
/// Returns the three owned keys as they stand after the write.
#[tauri::command]
pub fn agent_settings_write(
    agent: String,
    patch: AgentSettingsPatch,
    state: tauri::State<'_, crate::ActiveProject>,
) -> Result<AgentSettings, String> {
    let dir = branch_dir(&crate::active_project(&state)?, &agent)?;
    write_agent_settings_at(&dir.join(AGENT_SETTINGS_RELATIVE), &patch)
}

fn hooks_mute_flag() -> PathBuf {
    std::env::temp_dir().join(HOOKS_MUTE_FLAG)
}

/// Sounds are ACTIVE when the mute flag is absent - the reading is inverted
/// on purpose so the frontend toggle reads as "hook sounds: on".
fn hooks_sound_active_at(flag: &Path) -> bool {
    !flag.exists()
}

/// Flip the flag toward `active`. Both directions are idempotent: muting a
/// muted fleet and unmuting an unmuted one are no-ops, never errors, because
/// two BAUD windows (or a `drone @hooks` toggle) may race on the same file.
fn hooks_sound_set_at(flag: &Path, active: bool) -> Result<(), String> {
    if active {
        match fs::remove_file(flag) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(format!(
                "could not remove the mute flag '{}': {err}",
                flag.display()
            )),
        }
    } else {
        // Touch: @hooks only ever asks whether the path exists.
        fs::write(flag, b"")
            .map_err(|err| format!("could not write the mute flag '{}': {err}", flag.display()))
    }
}

/// BAUD's own settings for the seated project - opaque to the backend, which
/// stores what the frontend asks it to store and reads it back.
#[tauri::command]
pub fn baud_settings_read(
    state: tauri::State<'_, crate::ActiveProject>,
) -> Result<Value, String> {
    let path = crate::active_project(&state)?.root.join(BAUD_SETTINGS_RELATIVE);
    Ok(Value::Object(read_object(&path)?))
}

/// Shallow top-level merge into BAUD's settings; a `null` value removes its
/// key. Returns the whole document as written.
#[tauri::command]
pub fn baud_settings_write(
    patch: Value,
    state: tauri::State<'_, crate::ActiveProject>,
) -> Result<Value, String> {
    let path = crate::active_project(&state)?.root.join(BAUD_SETTINGS_RELATIVE);
    write_baud_settings_at(&path, patch)
}

/// Are AIPass hook sounds active right now? Read live, never cached: @hooks,
/// a shell, or another window can flip the flag between two glances.
#[tauri::command]
pub fn hooks_sound_get() -> bool {
    hooks_sound_active_at(&hooks_mute_flag())
}

/// Turn hook sounds on (remove the flag) or off (touch it). Returns the state
/// as it stands AFTER the write, so the toggle shows the disk, not the click.
#[tauri::command]
pub fn hooks_sound_set(active: bool) -> Result<bool, String> {
    let flag = hooks_mute_flag();
    hooks_sound_set_at(&flag, active)?;
    Ok(hooks_sound_active_at(&flag))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_dir(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "baud-settings-test-{tag}-{}-{}",
            std::process::id(),
            WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".claude")).expect("temp .claude dir");
        root
    }

    fn agent_file(root: &Path) -> PathBuf {
        root.join(AGENT_SETTINGS_RELATIVE)
    }

    /// The shape a real branch file has (@devpulse's, 2026-08-11) - the
    /// permission block is the thing that must survive every write.
    const SEEDED: &str = r#"{
  "permissions": {
    "allow": [],
    "deny": ["Bash(rm -rf*)", "Bash(rm -r *)"],
    "ask": []
  },
  "enabledMcpjsonServers": [],
  "autoCompactWindow": 350000,
  "prefersReducedMotion": true
}"#;

    fn patch_model(model: &str) -> AgentSettingsPatch {
        AgentSettingsPatch {
            model: Some(Some(model.to_string())),
            ..Default::default()
        }
    }

    #[test]
    fn missing_file_reads_as_all_unset() {
        let root = settings_dir("missing");
        assert_eq!(
            read_agent_settings_at(&agent_file(&root)).expect("quiet default"),
            AgentSettings::default()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_preserves_every_key_it_does_not_own() {
        let root = settings_dir("preserve");
        let path = agent_file(&root);
        fs::write(&path, SEEDED).expect("seed");

        let settings = write_agent_settings_at(&path, &patch_model("opus")).expect("patched");
        assert_eq!(settings.model.as_deref(), Some("opus"));

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("read back")).expect("json");
        let before: Value = serde_json::from_str(SEEDED).expect("json");
        // Load-bearing operator config, byte for byte in meaning.
        assert_eq!(after["permissions"], before["permissions"]);
        assert_eq!(after["enabledMcpjsonServers"], before["enabledMcpjsonServers"]);
        assert_eq!(after["prefersReducedMotion"], before["prefersReducedMotion"]);
        // An owned key the patch never mentioned is equally untouched.
        assert_eq!(after["autoCompactWindow"], before["autoCompactWindow"]);
        assert_eq!(after["model"], Value::from("opus"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explicit_null_removes_only_its_own_key() {
        let root = settings_dir("remove");
        let path = agent_file(&root);
        fs::write(&path, SEEDED).expect("seed");
        write_agent_settings_at(&path, &patch_model("sonnet")).expect("set");

        let settings = write_agent_settings_at(
            &path,
            &AgentSettingsPatch {
                model: Some(None),
                ..Default::default()
            },
        )
        .expect("removed");
        assert_eq!(settings.model, None);
        assert_eq!(settings.auto_compact_window, Some(350000));

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("read back")).expect("json");
        assert!(after.get("model").is_none(), "the key is gone, not nulled");
        assert!(after.get("permissions").is_some());
        assert_eq!(after["autoCompactWindow"], Value::from(350000));
        let _ = fs::remove_dir_all(&root);
    }

    /// @baud's own seat as Patrick found it (2026-08-13): a file carrying ONLY
    /// the model key, no compact keys. The write path stamps both of them onto
    /// it without complaint - so a missing compact dial is never this layer's
    /// doing. It was the panel above, which had no way to send the patch.
    const MODEL_ONLY: &str = "{\n  \"model\": \"fable\"\n}\n";

    #[test]
    fn compact_keys_land_beside_a_lone_model_key() {
        let root = settings_dir("compact-land");
        let path = agent_file(&root);
        fs::write(&path, MODEL_ONLY).expect("seed");

        let settings = write_agent_settings_at(
            &path,
            &AgentSettingsPatch {
                auto_compact_enabled: Some(Some(true)),
                auto_compact_window: Some(Some(350_000)),
                ..Default::default()
            },
        )
        .expect("stamped");
        assert_eq!(settings.model.as_deref(), Some("fable"), "model untouched");
        assert_eq!(settings.auto_compact_enabled, Some(true));
        assert_eq!(settings.auto_compact_window, Some(350_000));

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("read back")).expect("json");
        assert_eq!(after["model"], Value::from("fable"));
        assert_eq!(after["autoCompactEnabled"], Value::from(true));
        assert_eq!(after["autoCompactWindow"], Value::from(350_000));
        let _ = fs::remove_dir_all(&root);
    }

    /// The other half of the fixed panel's new vocabulary: picking Inherit
    /// clears BOTH compact keys in one patch and leaves the model alone.
    #[test]
    fn inherit_clears_both_compact_keys_and_keeps_the_model() {
        let root = settings_dir("compact-inherit");
        let path = agent_file(&root);
        fs::write(&path, SEEDED).expect("seed");
        write_agent_settings_at(&path, &patch_model("fable")).expect("set model");

        let settings = write_agent_settings_at(
            &path,
            &AgentSettingsPatch {
                auto_compact_enabled: Some(None),
                auto_compact_window: Some(None),
                ..Default::default()
            },
        )
        .expect("cleared");
        assert_eq!(settings.model.as_deref(), Some("fable"));
        assert_eq!(settings.auto_compact_enabled, None);
        assert_eq!(settings.auto_compact_window, None);

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("read back")).expect("json");
        assert!(after.get("autoCompactWindow").is_none(), "key gone, not nulled");
        assert!(after.get("autoCompactEnabled").is_none());
        assert_eq!(after["model"], Value::from("fable"));
        assert!(after.get("permissions").is_some(), "operator config survives");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn corrupt_file_errors_and_leaves_the_file_untouched() {
        let root = settings_dir("corrupt");
        let path = agent_file(&root);
        let corrupt = "{\"permissions\": {\"deny\": [\"Bash(rm -rf*)\"],,,";
        fs::write(&path, corrupt).expect("seed");

        assert!(read_agent_settings_at(&path).is_err(), "reads refuse to guess");
        assert!(write_agent_settings_at(&path, &patch_model("opus")).is_err());
        assert_eq!(fs::read_to_string(&path).expect("still there"), corrupt);
        // And no temp file was left lying beside it.
        let strays: Vec<_> = fs::read_dir(root.join(".claude"))
            .expect("dir")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(strays.is_empty(), "no temp residue: {strays:?}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_json_file_that_is_not_an_object_is_refused() {
        let root = settings_dir("array");
        let path = agent_file(&root);
        fs::write(&path, "[1, 2, 3]").expect("seed");
        assert!(write_agent_settings_at(&path, &patch_model("opus")).is_err());
        assert_eq!(fs::read_to_string(&path).expect("still there"), "[1, 2, 3]");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_creates_the_settings_dir_when_the_branch_has_none() {
        let root = settings_dir("fresh");
        let path = root.join("nested").join(AGENT_SETTINGS_RELATIVE);
        let settings = write_agent_settings_at(&path, &patch_model("haiku")).expect("created");
        assert_eq!(settings.model.as_deref(), Some("haiku"));
        assert_eq!(
            read_agent_settings_at(&path).expect("read back").model.as_deref(),
            Some("haiku")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn patch_json_separates_absent_from_null_from_value() {
        let absent: AgentSettingsPatch = serde_json::from_str("{}").expect("absent");
        assert!(absent.model.is_none(), "absent means untouched");

        let cleared: AgentSettingsPatch =
            serde_json::from_str(r#"{"model": null}"#).expect("null");
        assert_eq!(cleared.model, Some(None), "null means remove");

        let set: AgentSettingsPatch = serde_json::from_str(
            r#"{"model": "opus", "auto_compact_enabled": false, "auto_compact_window": 200000}"#,
        )
        .expect("set");
        assert_eq!(set.model, Some(Some("opus".to_string())));
        assert_eq!(set.auto_compact_enabled, Some(Some(false)));
        assert_eq!(set.auto_compact_window, Some(Some(200000)));
    }

    /// THE SILENT-LOSS CASE, and the one this module's own doc comment always
    /// forbade: "the write path must never treat unreadable as blank".
    ///
    /// A directory standing where the settings file belongs is the cheapest
    /// unreadable-but-present file this harness can build - no privileges
    /// involved, so it behaves the same for root and for a person. What it
    /// proves is the general shape: `read_to_string` failed for a reason that
    /// is NOT "nothing is there", and a blank document is then a claim nobody
    /// can support.
    #[test]
    fn an_unreadable_file_refuses_rather_than_reading_blank() {
        let root = settings_dir("unreadable");
        let path = agent_file(&root);
        fs::create_dir_all(&path).expect("a directory in the file's place");

        let outcome = read_object(&path);
        assert!(
            outcome.is_err(),
            "a file that exists and cannot be read must never read as {{}}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// The same fault seen from the write path, which is where it costs
    /// something: seeded permission rules, a settings file that goes
    /// unreadable, and a patch that must NOT proceed. Before the fix this
    /// wrote a three-key document over @devpulse's deny list without a word.
    ///
    /// Unix only, and it SKIPS ITSELF under a uid that ignores the mode bits
    /// rather than pretending to have tested something. The skip is measured,
    /// not assumed: the test chmods the file and then tries to read it, and
    /// only continues if the read actually failed.
    #[cfg(unix)]
    #[test]
    fn a_write_over_an_unreadable_file_leaves_the_file_alone() {
        use std::os::unix::fs::PermissionsExt;

        let root = settings_dir("locked");
        let path = agent_file(&root);
        fs::write(&path, SEEDED).expect("seed");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("lock");

        if fs::read_to_string(&path).is_ok() {
            // Running as root: the mode bits are advisory here and there is no
            // unreadable file to test with. Say so by doing nothing.
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o644));
            let _ = fs::remove_dir_all(&root);
            return;
        }

        let outcome = write_agent_settings_at(&path, &patch_model("opus"));
        assert!(outcome.is_err(), "a patch over an unreadable file must refuse");

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("unlock");
        assert_eq!(
            fs::read_to_string(&path).expect("read back"),
            SEEDED,
            "the operator's file is byte-for-byte what it was"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn model_strings_pass_through_opaque() {
        let root = settings_dir("opaque");
        let path = agent_file(&root);
        // Not a model id anyone ships - the backend still stores it verbatim.
        let settings = write_agent_settings_at(&path, &patch_model("some-future-model-4.5")).expect("stored");
        assert_eq!(settings.model.as_deref(), Some("some-future-model-4.5"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn baud_settings_merge_is_shallow_and_null_removes() {
        let root = settings_dir("baud");
        let path = root.join(BAUD_SETTINGS_RELATIVE);
        assert_eq!(
            Value::Object(read_object(&path).expect("missing is empty")),
            serde_json::json!({})
        );

        write_baud_settings_at(&path, serde_json::json!({"theme": "dark", "columns": 3}))
            .expect("first write");
        let after = write_baud_settings_at(
            &path,
            serde_json::json!({"columns": null, "pinned": ["prax"]}),
        )
        .expect("merge");

        assert_eq!(after, serde_json::json!({"theme": "dark", "pinned": ["prax"]}));
        assert_eq!(
            Value::Object(read_object(&path).expect("read back")),
            after,
            "what came back is what is on disk"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn baud_patch_must_be_an_object() {
        let root = settings_dir("baud-bad");
        let path = root.join(BAUD_SETTINGS_RELATIVE);
        assert!(write_baud_settings_at(&path, serde_json::json!("dark")).is_err());
        assert!(!path.exists(), "a refused patch writes nothing");
        let _ = fs::remove_dir_all(&root);
    }

    /// The flag file is exercised through a temp path, never the real one -
    /// a test run must not silence (or unsilence) the operator's fleet.
    #[test]
    fn hook_sounds_read_the_flag_and_both_flips_are_idempotent() {
        let root = settings_dir("hooks");
        let flag = root.join(HOOKS_MUTE_FLAG);

        assert!(hooks_sound_active_at(&flag), "no flag means sounds are on");

        hooks_sound_set_at(&flag, false).expect("mute");
        assert!(flag.exists(), "muting touches the flag");
        assert!(!hooks_sound_active_at(&flag));
        hooks_sound_set_at(&flag, false).expect("muting twice is a no-op");
        assert!(!hooks_sound_active_at(&flag));

        hooks_sound_set_at(&flag, true).expect("unmute");
        assert!(!flag.exists(), "unmuting removes the flag");
        assert!(hooks_sound_active_at(&flag));
        hooks_sound_set_at(&flag, true).expect("unmuting an unmuted fleet is a no-op");
        assert!(hooks_sound_active_at(&flag));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unwritable_flag_path_reports_instead_of_lying() {
        let root = settings_dir("hooks-bad");
        // A directory where the flag file should be: the touch cannot succeed.
        let flag = root.join(HOOKS_MUTE_FLAG);
        fs::create_dir_all(&flag).expect("occupy the path");
        assert!(hooks_sound_set_at(&flag, false).is_err(), "no silent failure");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_flag_lives_in_the_temp_dir_under_the_name_hooks_uses() {
        let flag = hooks_mute_flag();
        assert_eq!(flag.parent(), Some(std::env::temp_dir().as_path()));
        assert_eq!(flag.file_name().and_then(|n| n.to_str()), Some(HOOKS_MUTE_FLAG));
    }

    #[test]
    fn only_bare_branch_names_resolve() {
        let root = settings_dir("fence");
        let fleet = root.join("src").join("aipass");
        fs::create_dir_all(fleet.join("prax")).expect("branch dir");
        let project = crate::Project {
            name: "AIPASS".to_string(),
            root: root.clone(),
            fleet_dir: fleet,
            anchor: true,
        };

        assert!(branch_dir(&project, "prax").is_ok());
        assert!(branch_dir(&project, "../../etc").is_err(), "no traversal");
        assert!(branch_dir(&project, "/etc").is_err(), "no absolute paths");
        assert!(branch_dir(&project, "nested/branch").is_err(), "no separators");
        assert!(branch_dir(&project, "").is_err());
        assert!(branch_dir(&project, "ghost").is_err(), "must exist on disk");
        let _ = fs::remove_dir_all(&root);
    }
}
