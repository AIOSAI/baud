//! THE READ SURFACE - directories, file text, and what git says is uncommitted.
//!
//! Every path that arrives from the frontend goes through `fenced_path_in`
//! against the seated project's root before anything opens it. That fence is
//! the whole security posture of this lane: the webview names a path, it never
//! chooses a root.
//!
//! The git reads are here rather than in their own file because they share that
//! fence and the same `FileText` envelope a diff comes back in.
//!
//! Lifted out of lib.rs by FPLAN-0445 without a line of it changing.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

use crate::*;

/// One entry in a directory listing, for the file tree.
#[derive(Debug, Clone, Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    /// Absolute path - handed back to `list_dir`/`read_file_text` verbatim.
    pub path: String,
    pub is_dir: bool,
}

/// A file's text for the read-only viewer.
#[derive(Debug, Clone, Serialize)]
pub struct FileText {
    pub path: String,
    pub content: String,
    /// True when the file was larger than the viewer cap and got cut.
    pub truncated: bool,
}

/// Directories the tree never descends into - machine residue, not content.
pub(crate) const NOISE_DIRS: [&str; 6] = [
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".venv",
    "dist",
];

/// The viewer refuses to load more than this - it is a reading pane, not a
/// log streamer. Larger files come back truncated with a flag.
pub(crate) const VIEWER_MAX_BYTES: u64 = 512 * 1024;

/// Canonicalize a frontend-supplied path and refuse anything outside the
/// seated project's root. This is the fence under every file-access command:
/// the webview can name paths, but only ones the fleet view already lives in
/// - and when the operator switches projects, the fence moves WITH the seat.
pub(crate) fn fenced_path_in(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|err| format!("could not canonicalize the project root: {err}"))?;
    let path = PathBuf::from(raw)
        .canonicalize()
        .map_err(|err| format!("could not resolve '{raw}': {err}"))?;
    if !path.starts_with(&root) {
        return Err(format!(
            "'{}' is outside the seated project - refusing to read it",
            path.display()
        ));
    }
    Ok(path)
}

/// Turn raw file bytes into viewer text: binary is refused (a text pane
/// rendering NULs helps nobody), oversized input is cut at the cap.
pub(crate) fn viewer_text(mut bytes: Vec<u8>, cap: usize) -> Result<(String, bool), String> {
    let truncated = bytes.len() > cap;
    if truncated {
        bytes.truncate(cap);
    }
    if bytes.contains(&0) {
        return Err("binary file - nothing to view".to_string());
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

/// List one directory level: dirs first, then files, both alphabetical.
/// Read-only and fenced; noise directories are filtered at the source.
#[tauri::command]
pub fn list_dir(path: String, state: tauri::State<'_, ActiveProject>) -> Result<Vec<DirEntryInfo>, String> {
    let dir = fenced_path_in(&active_project(&state)?.root, &path)?;
    let entries = fs::read_dir(&dir)
        .map_err(|err| format!("could not read '{}': {err}", dir.display()))?;

    let mut listing: Vec<DirEntryInfo> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.path().is_dir();
        if is_dir && NOISE_DIRS.contains(&name.as_str()) {
            continue;
        }
        listing.push(DirEntryInfo {
            name,
            path: entry.path().display().to_string(),
            is_dir,
        });
    }

    listing.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(listing)
}

/// Read a file for the viewer. Read-only and fenced, capped, text-only.
#[tauri::command]
pub fn read_file_text(path: String, state: tauri::State<'_, ActiveProject>) -> Result<FileText, String> {
    let file_path = fenced_path_in(&active_project(&state)?.root, &path)?;
    let file = fs::File::open(&file_path)
        .map_err(|err| format!("could not open '{}': {err}", file_path.display()))?;

    let mut bytes = Vec::new();
    // Read one byte past the cap so truncation is detectable without ever
    // pulling a multi-gigabyte log into memory.
    file.take(VIEWER_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("could not read '{}': {err}", file_path.display()))?;

    let (content, truncated) = viewer_text(bytes, VIEWER_MAX_BYTES as usize)?;
    Ok(FileText {
        path: file_path.display().to_string(),
        content,
        truncated,
    })
}

/// Resolve path candidates a terminal line mentioned into openable files.
/// Absolute candidates are tried as given; relative ones against `base` (the
/// seated room's branch dir), then the seated project's root. First attempt
/// that canonicalizes to a regular file inside the fence wins; everything
/// else is None - the terminal only underlines what will actually open.
#[tauri::command]
pub fn resolve_paths(
    base: Option<String>,
    candidates: Vec<String>,
    state: tauri::State<'_, ActiveProject>,
) -> Result<Vec<Option<String>>, String> {
    let root = active_project(&state)?.root;
    Ok(resolve_paths_in(&root, base.as_deref(), &candidates))
}

pub(crate) fn resolve_paths_in(root: &Path, base: Option<&str>, candidates: &[String]) -> Vec<Option<String>> {
    candidates
        .iter()
        .map(|candidate| resolve_candidate(root, base, candidate))
        .collect()
}

pub(crate) fn resolve_candidate(root: &Path, base: Option<&str>, candidate: &str) -> Option<String> {
    let raw = Path::new(candidate);
    let attempts: Vec<PathBuf> = if raw.is_absolute() {
        vec![raw.to_path_buf()]
    } else {
        base.iter()
            .map(|dir| Path::new(dir).join(raw))
            .chain(std::iter::once(root.join(raw)))
            .collect()
    };
    attempts.into_iter().find_map(|attempt| {
        let path = fenced_path_in(root, &attempt.display().to_string()).ok()?;
        path.is_file().then(|| path.display().to_string())
    })
}

/// Uncommitted edits in one branch's subtree, straight from local git.
#[derive(Debug, Clone, Serialize)]
pub struct GitChanges {
    pub files: Vec<String>,
    pub count: usize,
}

/// Run the installed `git` binary read-only inside `dir` and return stdout.
/// `None` covers every normal quiet case at once: not a repo, an empty repo
/// with no HEAD yet, or no git on the machine - all of which just mean
/// "nothing to report", not a fault worth surfacing on a card.
pub(crate) fn git_read(dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").current_dir(dir).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The uncommitted-changes list for a directory: tracked files under it that
/// differ from HEAD (staged or not). `--relative` keeps names local to the
/// branch dir instead of repo-root-relative - every src/aipass branch shares
/// one repo, and a card should only ever speak about its own subtree.
pub(crate) fn git_changes_in(dir: &Path) -> GitChanges {
    let files: Vec<String> = git_read(dir, &["diff", "HEAD", "--relative", "--name-only", "--", "."])
        .map(|out| out.lines().map(str::to_owned).collect())
        .unwrap_or_default();
    let count = files.len();
    GitChanges { files, count }
}

/// Every uncommitted path in the whole repository the project root sits in.
///
/// Deliberately NOT the same question the cards ask. A card asks "what has
/// changed under me?" with `diff HEAD`, which sees tracked files only; this
/// asks "what is uncommitted in this project?", which has to include files
/// git has never seen - a brand-new module is the most interesting change in
/// the tree, and a total that hid it would read as false calm. Hence
/// `status --porcelain`, and `-uall` so an untracked DIRECTORY expands to its
/// files instead of collapsing to one line.
///
/// Ignored files stay ignored: `target/`, `node_modules/` and `dist/` never
/// reach the count. One line of porcelain is one path, renames included.
pub(crate) fn git_project_changes_in(dir: &Path) -> GitChanges {
    let files: Vec<String> = git_read(dir, &["status", "--porcelain", "-uall"])
        .map(|out| {
            out.lines()
                .filter(|line| !line.trim().is_empty())
                // Porcelain v1: two status columns, a space, then the path.
                .map(|line| line.get(3..).unwrap_or(line).to_owned())
                .collect()
        })
        .unwrap_or_default();
    let count = files.len();
    GitChanges { files, count }
}

/// The full uncommitted diff for a directory, as one patch text.
pub(crate) fn git_diff_in(dir: &Path) -> Result<FileText, String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["diff", "HEAD", "--relative", "--", "."])
        .output()
        .map_err(|err| format!("could not run git: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr.trim()));
    }
    let (content, truncated) = viewer_text(output.stdout, VIEWER_MAX_BYTES as usize)?;
    Ok(FileText {
        path: dir.display().to_string(),
        content,
        truncated,
    })
}

/// Count a branch's uncommitted files for the card badge. Fenced, read-only.
#[tauri::command]
pub fn git_changes(path: String, state: tauri::State<'_, ActiveProject>) -> Result<GitChanges, String> {
    Ok(git_changes_in(&fenced_path_in(&active_project(&state)?.root, &path)?))
}

/// The seated project's whole-repo uncommitted count, for the header total.
///
/// Takes no path on purpose: the frontend cannot aim this at a directory, so
/// the read stays pinned to whatever project the operator is seated in.
#[tauri::command]
pub fn git_project_changes(state: tauri::State<'_, ActiveProject>) -> Result<GitChanges, String> {
    Ok(git_project_changes_in(&active_project(&state)?.root))
}

/// The diff behind the badge, for the changes tab. Fenced, read-only.
#[tauri::command]
pub fn git_diff_text(path: String, state: tauri::State<'_, ActiveProject>) -> Result<FileText, String> {
    git_diff_in(&fenced_path_in(&active_project(&state)?.root, &path)?)
}

/// Read a `quick_status` count that may be a number or a list of items.
pub(crate) fn count_field(quick_status: &Value, key: &str) -> u64 {
    match quick_status.get(key) {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::Array(items)) => items.len() as u64,
        Some(Value::String(text)) => text.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}
