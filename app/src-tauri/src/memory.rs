//! The memory dials (m13): a front-end to @memory's own config file.
//!
//! `src/aipass/memory/memory_json/custom_config/memory.config.json` under the
//! AIPass root holds two sets of numbers every citizen in the ecosystem lives
//! under - how many characters one memory entry may be, and how many entries a
//! file keeps before the oldest roll off to vectors. They were editable only
//! by hand, which meant nobody turned them.
//!
//! The file is @memory's, not BAUD's, and this module never forgets that. It
//! is the same doctrine as `settings.rs`: parse the whole document, change
//! only the specific numbers the operator moved, hand every other key back
//! untouched, and refuse outright rather than guess. Two rules are stricter
//! here than in the agent-settings writer, because this file is shared by the
//! whole fleet rather than owned by one branch:
//!
//! - A dial that does not already exist on disk is NOT created. BAUD turns
//!   dials it can see; inventing an entry type or a rollover group in another
//!   agent's config is exactly the cross-edit the ecosystem forbids.
//! - Zero is refused for character caps and keep-counts. It is the one value
//!   that reads as a valid number and silently breaks every memory write in
//!   the fleet.
//!
//! What a save actually costs this file was measured, not assumed: on a copy
//! of the real 8KB config, one dial moved changes 2 of 364 lines. One is the
//! number; the other is @memory's own `_note`, whose em-dash was written as
//! `—` by Python and comes back as literal UTF-8. Same decoded string,
//! different spelling on disk - the one representational change BAUD cannot
//! avoid, and small enough to state rather than hide. (Before `preserve_order`
//! was turned on for serde_json, that same edit rewrote 310 of 364 lines.)
//!
//! The two halves apply differently, and the UI has to say so: `entry_limits`
//! are re-read live by the enforcement hook, so an edit binds on the next
//! memory write, while rollover counts are defaults that reach the branches
//! only when the operator runs `drone @memory rollover push`. BAUD states that
//! command; it does not run it. Pushing config to seventeen branches is
//! @memory's job, not a side effect of closing a settings panel.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Where @memory keeps the dials, relative to the AIPass root.
const CONFIG_RELATIVE: &[&str] = &[
    "src",
    "aipass",
    "memory",
    "memory_json",
    "custom_config",
    "memory.config.json",
];

/// Rollover groups carry a `_note` string beside their dial objects. It is
/// documentation for whoever opens the file by hand, not a dial.
const NOTE_KEY: &str = "_note";

/// One entry type's character cap, with the file and field it governs so the
/// panel can say what the number actually limits.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EntryLimit {
    /// The entry type as @memory names it: `key_learnings`, `sessions`, ...
    pub key: String,
    /// The `.trinity/` file it lives in.
    pub file: String,
    /// The array inside that file.
    pub container: String,
    /// The field of each entry the cap measures.
    pub field: String,
    pub max_chars: u64,
}

/// One rollover dial: how many entries a container keeps.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RolloverDial {
    /// The group the dial sits under - `local` or `observations`, matching the
    /// file it governs. Part of the dial's identity: a patch names both.
    pub group: String,
    /// The container inside that group: `sessions`, `key_learnings`, ...
    pub key: String,
    pub count: u64,
    /// Only `sessions` carries one today; absent means the key is not on disk
    /// and BAUD will not create it.
    pub auto_compact_cap: Option<u64>,
}

/// A branch that overrides the defaults. Read-only in the panel: these are
/// written by `drone @memory rollover push`, and hand-editing seventeen of
/// them through a settings dialog is not a job BAUD should invite.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BranchOverride {
    pub branch: String,
    pub dials: Vec<RolloverDial>,
}

/// The whole surface the Memory section renders.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MemoryConfig {
    /// The file this came from, shown so the operator can always find it.
    pub path: String,
    /// `entry_limits.enabled && entry_limits.enforce` - when false the caps on
    /// screen are documentation, not enforcement, and the panel says so rather
    /// than implying teeth the hook is not using.
    pub enforced: bool,
    pub entry_limits: Vec<EntryLimit>,
    pub rollover: Vec<RolloverDial>,
    pub per_branch: Vec<BranchOverride>,
}

/// One cap edit from the panel.
#[derive(Debug, Clone, Deserialize)]
pub struct CapEdit {
    pub key: String,
    pub max_chars: u64,
}

/// One rollover-dial edit. `count` and `auto_compact_cap` are independent:
/// absent means "not touched", so moving one never rewrites the other.
#[derive(Debug, Clone, Deserialize)]
pub struct RolloverEdit {
    pub group: String,
    pub key: String,
    #[serde(default)]
    pub count: Option<u64>,
    #[serde(default)]
    pub auto_compact_cap: Option<u64>,
}

/// Everything one save may change. An empty patch is a legal no-op write.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct MemoryConfigPatch {
    #[serde(default)]
    pub caps: Vec<CapEdit>,
    #[serde(default)]
    pub rollover: Vec<RolloverEdit>,
}

fn config_path() -> Result<PathBuf, String> {
    let root = crate::resolve_aipass_root()?;
    Ok(crate::join_all(&root, CONFIG_RELATIVE))
}

fn as_object<'a>(parent: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    parent.get(key).and_then(Value::as_object)
}

/// Read the dials out of a parsed document. Anything shaped unexpectedly is
/// skipped rather than fatal: a new entry type @memory adds tomorrow should
/// not blank the panel, it should simply not appear until BAUD understands it.
fn config_in(path: &str, document: &Map<String, Value>) -> MemoryConfig {
    let limits = as_object(document, "entry_limits");
    let enforced = limits
        .map(|limits| {
            limits.get("enabled").and_then(Value::as_bool).unwrap_or(false)
                && limits.get("enforce").and_then(Value::as_bool).unwrap_or(false)
        })
        .unwrap_or(false);

    let mut entry_limits: Vec<EntryLimit> = limits
        .and_then(|limits| as_object(limits, "entry_types"))
        .map(|types| {
            types
                .iter()
                .filter_map(|(key, value)| {
                    let entry = value.as_object()?;
                    Some(EntryLimit {
                        key: key.clone(),
                        file: string_at(entry, "file"),
                        container: string_at(entry, "container"),
                        field: string_at(entry, "field"),
                        max_chars: entry.get("max_chars").and_then(Value::as_u64)?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    entry_limits.sort_by(|a, b| a.key.cmp(&b.key));

    let rollover = as_object(document, "rollover");
    let defaults = rollover
        .and_then(|rollover| as_object(rollover, "defaults"))
        .map(dials_in)
        .unwrap_or_default();

    let mut per_branch: Vec<BranchOverride> = rollover
        .and_then(|rollover| as_object(rollover, "per_branch"))
        .map(|branches| {
            branches
                .iter()
                .filter_map(|(branch, value)| {
                    let dials = dials_in(value.as_object()?);
                    (!dials.is_empty()).then(|| BranchOverride {
                        branch: branch.clone(),
                        dials,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    per_branch.sort_by(|a, b| a.branch.cmp(&b.branch));

    MemoryConfig {
        path: path.to_string(),
        enforced,
        entry_limits,
        rollover: defaults,
        per_branch,
    }
}

fn string_at(entry: &Map<String, Value>, key: &str) -> String {
    entry.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// The `{group: {key: {count, auto_compact_cap}}}` shape both `defaults` and
/// every `per_branch` entry use, flattened into dials and sorted so the panel
/// never reorders itself between reads.
fn dials_in(groups: &Map<String, Value>) -> Vec<RolloverDial> {
    let mut dials: Vec<RolloverDial> = Vec::new();
    for (group, value) in groups {
        if group == NOTE_KEY {
            continue;
        }
        let Some(containers) = value.as_object() else {
            continue;
        };
        for (key, dial) in containers {
            if key == NOTE_KEY {
                continue;
            }
            let Some(dial) = dial.as_object() else {
                continue;
            };
            let Some(count) = dial.get("count").and_then(Value::as_u64) else {
                continue;
            };
            dials.push(RolloverDial {
                group: group.clone(),
                key: key.clone(),
                count,
                auto_compact_cap: dial.get("auto_compact_cap").and_then(Value::as_u64),
            });
        }
    }
    dials.sort_by(|a, b| (&a.group, &a.key).cmp(&(&b.group, &b.key)));
    dials
}

/// Apply the patch in place, naming only dials that already exist. Every
/// refusal is a hard error carrying the dial that was not found: a save that
/// silently skipped an edit would leave the panel showing a number the file
/// does not hold.
fn apply_patch(document: &mut Map<String, Value>, patch: &MemoryConfigPatch) -> Result<(), String> {
    for cap in &patch.caps {
        if cap.max_chars == 0 {
            return Err(format!(
                "a character cap of 0 would refuse every '{}' entry - refusing to write it",
                cap.key
            ));
        }
        let entry = document
            .get_mut("entry_limits")
            .and_then(Value::as_object_mut)
            .and_then(|limits| limits.get_mut("entry_types"))
            .and_then(Value::as_object_mut)
            .and_then(|types| types.get_mut(&cap.key))
            .and_then(Value::as_object_mut)
            .ok_or_else(|| format!("no entry type '{}' in this config", cap.key))?;
        if !entry.contains_key("max_chars") {
            return Err(format!("'{}' has no max_chars to change", cap.key));
        }
        entry.insert("max_chars".to_string(), Value::from(cap.max_chars));
    }

    for edit in &patch.rollover {
        if edit.count == Some(0) {
            return Err(format!(
                "a keep-count of 0 would discard every '{}' entry - refusing to write it",
                edit.key
            ));
        }
        let dial = document
            .get_mut("rollover")
            .and_then(Value::as_object_mut)
            .and_then(|rollover| rollover.get_mut("defaults"))
            .and_then(Value::as_object_mut)
            .and_then(|defaults| defaults.get_mut(&edit.group))
            .and_then(Value::as_object_mut)
            .and_then(|group| group.get_mut(&edit.key))
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                format!("no rollover dial '{}/{}' in this config", edit.group, edit.key)
            })?;

        if let Some(count) = edit.count {
            if !dial.contains_key("count") {
                return Err(format!("'{}/{}' has no count to change", edit.group, edit.key));
            }
            dial.insert("count".to_string(), Value::from(count));
        }
        if let Some(cap) = edit.auto_compact_cap {
            // Absent on disk means this dial does not have one - adding it
            // would be BAUD inventing structure in @memory's file.
            if !dial.contains_key("auto_compact_cap") {
                return Err(format!(
                    "'{}/{}' has no auto_compact_cap to change",
                    edit.group, edit.key
                ));
            }
            dial.insert("auto_compact_cap".to_string(), Value::from(cap));
        }
    }

    Ok(())
}

fn read_config_at(path: &std::path::Path) -> Result<MemoryConfig, String> {
    if !path.is_file() {
        return Err(format!(
            "@memory's config is not at '{}' - nothing to show",
            path.display()
        ));
    }
    let document = crate::settings::read_object(path)?;
    Ok(config_in(&path.display().to_string(), &document))
}

fn write_config_at(path: &std::path::Path, patch: &MemoryConfigPatch) -> Result<MemoryConfig, String> {
    if !path.is_file() {
        return Err(format!(
            "@memory's config is not at '{}' - refusing to create it",
            path.display()
        ));
    }
    // Read, then validate, then write: every refusal returns before a byte is
    // touched, so a rejected save leaves the file exactly as it was.
    let mut document = crate::settings::read_object(path)?;
    apply_patch(&mut document, patch)?;
    crate::settings::write_atomically(path, &Value::Object(document))?;
    read_config_at(path)
}

/// Run one of @memory's own config verbs and hand back the file afterwards.
///
/// ROLLOVER COUNTS ARE NOT BAUD'S TO WRITE (round A ruling). The character
/// caps above have no verb behind them and stay on the direct file lane, but
/// every keep-count now goes through `drone @memory config ...` so the bounds
/// (1-100) and the refusal sentences come from ONE place - @memory's - instead
/// of being re-implemented here and drifting the first time it changes them.
///
/// TWO THINGS MEASURED BEFORE THIS WAS WRITTEN, both of which shape it:
///
/// - A REFUSED VERB STILL EXITS 0. `config set @baud sessions 0` prints
///   "Count must be at least 1 (got 0)" and returns success. So the exit
///   status is not the test and is deliberately not treated as one.
/// - There is no `--json` mode; the output is Rich-formatted for a human.
///
/// So the verb's own sentence is passed straight through for the panel to
/// show, and the PROOF that a write happened is the file read back afterwards.
/// Not any string this function parsed: a caller compares the number it asked
/// for with the number that came back.
fn run_memory_verb(args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("drone")
        .arg("@memory")
        .args(args)
        .output()
        .map_err(|err| format!("could not run drone @memory: {err}"))?;
    let spoken = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    // @memory marks its own refusals; the exit code cannot be asked.
    if spoken.contains('❌') {
        return Err(refusal_sentence(&spoken));
    }
    if !output.status.success() {
        return Err(format!("drone @memory refused: {}", refusal_sentence(&spoken)));
    }
    Ok(spoken)
}

/// @memory's refusal, in @memory's words - the marked line and the line under
/// it, which is where its "→ Try:" explanation lives. Never reworded: a
/// sentence the operator can search for beats one BAUD invented.
fn refusal_sentence(spoken: &str) -> String {
    let lines: Vec<&str> = spoken
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let marked = lines.iter().position(|line| line.contains('❌'));
    match marked {
        Some(index) => lines[index..]
            .iter()
            .take(2)
            .copied()
            .collect::<Vec<_>>()
            .join(" "),
        None => lines.join(" "),
    }
}

/// One branch's keep-count, through @memory's verb.
#[tauri::command]
pub fn memory_config_set(branch: String, entry_type: String, count: u64) -> Result<MemoryConfig, String> {
    let target = format!("@{}", branch.trim_start_matches('@'));
    let number = count.to_string();
    run_memory_verb(&["config", "set", &target, &entry_type, &number])?;
    read_config_at(&config_path()?)
}

/// A default keep-count, through @memory's verb. Does NOT reach any branch -
/// that is what the push is for, and the panel says so.
#[tauri::command]
pub fn memory_config_set_default(entry_type: String, count: u64) -> Result<MemoryConfig, String> {
    let number = count.to_string();
    run_memory_verb(&["config", "set-default", &entry_type, &number])?;
    read_config_at(&config_path()?)
}

/// Reset EVERY branch to the defaults. The one fleet-wide door, and the panel
/// asks twice before it opens.
#[tauri::command]
pub fn memory_config_push() -> Result<MemoryConfig, String> {
    run_memory_verb(&["rollover", "push"])?;
    read_config_at(&config_path()?)
}

/// The dials as they are on disk right now.
#[tauri::command]
pub fn memory_config_read() -> Result<MemoryConfig, String> {
    read_config_at(&config_path()?)
}

/// Move dials the operator turned, then hand back what the file says
/// afterwards - the panel renders disk truth, never its own optimism.
#[tauri::command]
pub fn memory_config_write(patch: MemoryConfigPatch) -> Result<MemoryConfig, String> {
    write_config_at(&config_path()?, &patch)
}

#[cfg(test)]
mod tests {

    /// @memory's refusals exit ZERO - measured, not assumed - so the marked
    /// line is the only signal. This is the parser that reads it, and it must
    /// keep @memory's own words rather than summarising them.
    #[test]
    fn a_refusal_keeps_memorys_own_sentence() {
        let spoken = "\u{274c} Count must be at least 1 (got 0)\n   \u{2192} Try: A limit of 0 would roll over every entry immediately\n";
        let read = refusal_sentence(spoken);
        assert!(read.contains("Count must be at least 1 (got 0)"));
        // The line under the mark carries the explanation and comes with it.
        assert!(read.contains("would roll over every entry immediately"));

        // Nothing marked: everything spoken, never an empty error.
        let plain = refusal_sentence("something went sideways\n");
        assert_eq!(plain, "something went sideways");
    }
    use super::*;

    fn document() -> Map<String, Value> {
        let raw = serde_json::json!({
            "memory_pool": { "enabled": true, "keep_recent": 0 },
            "entry_limits": {
                "enabled": true,
                "enforce": true,
                "entry_types": {
                    "key_learnings": {
                        "file": "local.json",
                        "container": "key_learnings",
                        "kind": "list",
                        "field": "value",
                        "max_chars": 200
                    },
                    "sessions": {
                        "file": "local.json",
                        "container": "sessions",
                        "kind": "list",
                        "field": "summary",
                        "max_chars": 300
                    }
                },
                "per_branch": {}
            },
            "rollover": {
                "defaults": {
                    "local": {
                        "sessions": { "count": 15, "auto_compact_cap": 3 },
                        "key_learnings": { "count": 15 }
                    },
                    "observations": { "observations": { "count": 15 } },
                    "_note": "DEFAULTS - edit then push."
                },
                "per_branch": {
                    "backup": {
                        "local": { "sessions": { "count": 12, "auto_compact_cap": 3 } },
                        "_note": "Limits for @backup."
                    }
                }
            }
        });
        raw.as_object().unwrap().clone()
    }

    #[test]
    fn dials_read_out_of_the_real_shape() {
        let config = config_in("/x/memory.config.json", &document());

        assert!(config.enforced);
        assert_eq!(
            config.entry_limits.iter().map(|l| l.key.as_str()).collect::<Vec<_>>(),
            vec!["key_learnings", "sessions"],
            "entry types come back sorted, not in map order"
        );
        let learnings = &config.entry_limits[0];
        assert_eq!(learnings.max_chars, 200);
        assert_eq!(learnings.file, "local.json");
        assert_eq!(learnings.field, "value");

        // The `_note` strings beside the dials are documentation, not dials.
        assert_eq!(
            config
                .rollover
                .iter()
                .map(|d| (d.group.as_str(), d.key.as_str(), d.count, d.auto_compact_cap))
                .collect::<Vec<_>>(),
            vec![
                ("local", "key_learnings", 15, None),
                ("local", "sessions", 15, Some(3)),
                ("observations", "observations", 15, None),
            ]
        );

        assert_eq!(config.per_branch.len(), 1);
        assert_eq!(config.per_branch[0].branch, "backup");
        assert_eq!(config.per_branch[0].dials[0].count, 12);
    }

    #[test]
    fn a_disabled_enforcement_flag_is_reported_not_hidden() {
        let mut doc = document();
        doc.get_mut("entry_limits")
            .and_then(Value::as_object_mut)
            .unwrap()
            .insert("enforce".to_string(), Value::from(false));

        let config = config_in("/x", &doc);
        assert!(!config.enforced, "caps without teeth must not read as enforced");
        assert_eq!(config.entry_limits.len(), 2, "the numbers are still shown");
    }

    #[test]
    fn a_patch_moves_only_the_dials_it_names() {
        let mut doc = document();
        let patch = MemoryConfigPatch {
            caps: vec![CapEdit {
                key: "sessions".to_string(),
                max_chars: 400,
            }],
            rollover: vec![RolloverEdit {
                group: "local".to_string(),
                key: "sessions".to_string(),
                count: Some(20),
                auto_compact_cap: None,
            }],
        };
        apply_patch(&mut doc, &patch).expect("a patch naming real dials applies");

        let config = config_in("/x", &doc);
        assert_eq!(config.entry_limits[1].max_chars, 400, "the named cap moved");
        assert_eq!(config.entry_limits[0].max_chars, 200, "its neighbour did not");
        let sessions = config.rollover.iter().find(|d| d.key == "sessions").unwrap();
        assert_eq!(sessions.count, 20);
        assert_eq!(
            sessions.auto_compact_cap,
            Some(3),
            "an untouched sibling key keeps its value"
        );

        // Everything this module does not own survives verbatim.
        assert_eq!(
            doc.get("memory_pool"),
            document().get("memory_pool"),
            "unrelated config must come through untouched"
        );
        assert!(
            doc.get("rollover")
                .and_then(|r| r.get("defaults"))
                .and_then(|d| d.get("_note"))
                .is_some(),
            "the file's own notes survive a write"
        );
    }

    #[test]
    fn unknown_dials_and_zeroes_are_refused() {
        let mut doc = document();

        let unknown_type = MemoryConfigPatch {
            caps: vec![CapEdit {
                key: "invented".to_string(),
                max_chars: 100,
            }],
            ..Default::default()
        };
        assert!(
            apply_patch(&mut doc, &unknown_type).is_err(),
            "BAUD must not create an entry type @memory never declared"
        );

        let unknown_dial = MemoryConfigPatch {
            rollover: vec![RolloverEdit {
                group: "local".to_string(),
                key: "invented".to_string(),
                count: Some(5),
                auto_compact_cap: None,
            }],
            ..Default::default()
        };
        assert!(apply_patch(&mut doc, &unknown_dial).is_err());

        let missing_cap_key = MemoryConfigPatch {
            rollover: vec![RolloverEdit {
                group: "local".to_string(),
                key: "key_learnings".to_string(),
                count: None,
                // This dial has no auto_compact_cap on disk.
                auto_compact_cap: Some(3),
            }],
            ..Default::default()
        };
        assert!(
            apply_patch(&mut doc, &missing_cap_key).is_err(),
            "a key absent from disk is not BAUD's to add"
        );

        let zero_cap = MemoryConfigPatch {
            caps: vec![CapEdit {
                key: "sessions".to_string(),
                max_chars: 0,
            }],
            ..Default::default()
        };
        assert!(apply_patch(&mut doc, &zero_cap).is_err(), "0 chars bricks writes");

        let zero_count = MemoryConfigPatch {
            rollover: vec![RolloverEdit {
                group: "local".to_string(),
                key: "sessions".to_string(),
                count: Some(0),
                auto_compact_cap: None,
            }],
            ..Default::default()
        };
        assert!(apply_patch(&mut doc, &zero_count).is_err());

        // Every refusal above left the document exactly as it started.
        assert_eq!(doc, document(), "a refused patch changes nothing");
    }

    #[test]
    fn a_save_round_trips_through_the_file_and_refuses_before_writing() {
        // The fixture is the shape, not the live config: this test must pass
        // on a bare CI checkout with no AIPass tree anywhere above it.
        let dir = std::env::temp_dir().join(format!("baud-memcfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("memory.config.json");
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&Value::Object(document())).unwrap(),
        )
        .unwrap();
        let before = std::fs::read_to_string(&path).unwrap();

        let patch = MemoryConfigPatch {
            caps: vec![CapEdit {
                key: "key_learnings".to_string(),
                max_chars: 250,
            }],
            rollover: vec![RolloverEdit {
                group: "observations".to_string(),
                key: "observations".to_string(),
                count: Some(20),
                auto_compact_cap: None,
            }],
        };
        let saved = write_config_at(&path, &patch).expect("a real save lands");

        // What came back is the file re-read, and the file agrees.
        assert_eq!(saved.entry_limits[0].max_chars, 250);
        let on_disk = read_config_at(&path).expect("the written file still parses");
        assert_eq!(saved, on_disk);
        let observations = on_disk
            .rollover
            .iter()
            .find(|d| d.key == "observations")
            .unwrap();
        assert_eq!(observations.count, 20);
        assert_eq!(
            on_disk.entry_limits[1].max_chars, 300,
            "the neighbouring cap is untouched"
        );

        // A refusal must not leave a half-written file behind.
        let doomed = MemoryConfigPatch {
            caps: vec![CapEdit {
                key: "sessions".to_string(),
                max_chars: 0,
            }],
            ..Default::default()
        };
        let after_save = std::fs::read_to_string(&path).unwrap();
        assert!(write_config_at(&path, &doomed).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            after_save,
            "a refused write leaves the file byte-identical"
        );
        assert_ne!(before, after_save, "the accepted write really did change it");

        // A missing file is never created - the config belongs to @memory.
        assert!(write_config_at(&dir.join("absent.json"), &MemoryConfigPatch::default()).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
