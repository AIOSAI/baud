//! THE CENSUS - which projects exist, and which one the window is seated in.
//!
//! A project is a directory carrying a `<NAME>_REGISTRY.json` seal; the seal's
//! filename stem IS the canonical name, and its active rows are its citizens.
//! The census is declared, never walked: the anchor, its `projects/*`, and the
//! active roots in the anchor's `AIPASS_ROOTS.json`. The seat lives in
//! `ActiveProject`, one mutex the whole app reads through, so every fenced read below resolves
//! against one answer rather than each command guessing its own root.
//!
//! Lifted out of lib.rs by FPLAN-0445 without a line of it changing.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::*;

/// The seal that turns a directory into a project: `<NAME>_REGISTRY.json` in
/// its root. The filename stem IS the canonical project name - the same
/// convention the wider ecosystem resolves external projects by.
pub(crate) const REGISTRY_SUFFIX: &str = "_REGISTRY.json";

/// Where a project keeps nested projects (AIPass keeps baud itself here).
pub(crate) const PROJECTS_SUBDIR: &str = "projects";

/// The anchor's list of repo roots taking part in this installation.
pub(crate) const ROOTS_FILE: &str = "AIPASS_ROOTS.json";

/// One project BAUD can seat its read surface in.
#[derive(Debug, Clone, Serialize)]
pub struct Project {
    /// Canonical name from the registry filename: `VERA-STUDIO_REGISTRY.json`
    /// seals "VERA-STUDIO".
    pub name: String,
    /// Absolute project root - the fence while this project is seated.
    pub root: PathBuf,
    /// Absolute directory the branch cards come from: the parent of the first
    /// active row's path, or the root itself for a flat layout.
    pub fleet_dir: PathBuf,
    /// Absolute branch dirs of the registry's active rows, in row order. A
    /// card's name is its dir's last component.
    pub citizens: Vec<PathBuf>,
    /// True for the anchor - the AIPass tree BAUD resolved at launch.
    pub anchor: bool,
}

impl Project {
    /// The room-name scope for this project's branches: anchor rooms keep
    /// their historical plain names, everyone else's carry the project.
    pub(crate) fn room_scope(&self) -> Option<String> {
        (!self.anchor).then(|| self.name.to_lowercase())
    }

    /// The citizen dir a card name stands for, if a registry row names one.
    pub(crate) fn citizen(&self, name: &str) -> Option<&Path> {
        self.citizens
            .iter()
            .find(|dir| dir.file_name().is_some_and(|last| last == name))
            .map(PathBuf::as_path)
    }
}

/// One row of the switcher menu.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectListing {
    pub name: String,
    pub root: String,
    pub anchor: bool,
    pub active: bool,
}

/// Which project the fleet view, the fence, and new shells follow.
///
/// `None` means the anchor. Only [`project_switch`] ever writes it, and only
/// to a project the backend discovered itself - the frontend cannot steer
/// BAUD into an arbitrary directory by name or by path.
#[cfg(feature = "gui")]
#[derive(Default)]
pub struct ActiveProject(Mutex<Option<Project>>);

/// The registry file sealing `dir`, if any. Legacy trees can carry several;
/// the lexically first wins so the answer never depends on readdir order.
pub(crate) fn registry_in(dir: &Path) -> Option<PathBuf> {
    registries_in(dir).into_iter().next()
}

/// Every registry seal in `dir`, sorted.
pub(crate) fn registries_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut seals: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .map(|name| {
                        let name = name.to_string_lossy();
                        name.len() > REGISTRY_SUFFIX.len() && name.ends_with(REGISTRY_SUFFIX)
                    })
                    .unwrap_or(false)
        })
        .collect();
    seals.sort();
    seals
}

/// Read a sealed directory into a [`Project`].
///
/// Citizens are the registry's rows with `status` "active", each path taken
/// relative to the registry's directory (absolute accepted) - the same rule
/// the memory branch reads the fleet by. The fleet dir is the parent of the
/// first one, or the project root when that row has no parent (a flat
/// layout). Reads as `None` when the seal is missing, no active row has a
/// path, or the fleet dir is gone from disk.
pub(crate) fn project_from_dir(dir: &Path, anchor: bool) -> Option<Project> {
    let registry = registry_in(dir)?;
    let file_name = registry.file_name()?.to_string_lossy().into_owned();
    let name = file_name.strip_suffix(REGISTRY_SUFFIX)?.to_string();

    let raw = fs::read_to_string(&registry).ok()?;
    let document: Value = serde_json::from_str(&raw).ok()?;

    let citizens: Vec<PathBuf> = document
        .get("branches")
        .and_then(Value::as_array)?
        .iter()
        .filter(|row| row.get("status").and_then(Value::as_str) == Some("active"))
        .filter_map(|row| row.get("path").and_then(Value::as_str))
        .filter(|path| !path.is_empty())
        .map(|path| dir.join(path))
        .collect();

    let fleet_dir = citizens.first()?.parent()?.to_path_buf();
    if !fleet_dir.is_dir() {
        return None;
    }

    Some(Project {
        name,
        root: dir.to_path_buf(),
        fleet_dir,
        citizens,
        anchor,
    })
}

/// The active repo roots the anchor's `AIPASS_ROOTS.json` declares, resolved,
/// in declaration order. Paths are relative to the anchor (absolute
/// accepted); a row whose status is not "active", whose path is not a
/// directory, or which overlaps the anchor itself is skipped. A missing or
/// unreadable file declares nothing.
pub(crate) fn declared_roots(home: &Path) -> Vec<PathBuf> {
    let Ok(raw) = fs::read_to_string(home.join(ROOTS_FILE)) else {
        return Vec::new();
    };
    let Ok(document) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let canonical_home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    document
        .get("roots")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|row| row.get("status").and_then(Value::as_str) == Some("active"))
        .filter_map(|row| row.get("path").and_then(Value::as_str))
        .filter(|path| !path.is_empty())
        .filter_map(|path| home.join(path).canonicalize().ok())
        .filter(|root| {
            root.is_dir() && !root.starts_with(&canonical_home) && !canonical_home.starts_with(root)
        })
        .collect()
}

/// The anchor as a project. An anchor tree whose registry is unreadable or
/// unsealed still seats - `resolve_aipass_root` already proved `src/aipass`
/// exists, so the classic layout is the honest fallback.
pub(crate) fn anchor_project() -> Result<Project, String> {
    let root = resolve_aipass_root()?;
    Ok(project_from_dir(&root, true).unwrap_or_else(|| Project {
        name: "AIPASS".to_string(),
        fleet_dir: join_all(&root, &FLEET_RELATIVE_DIR),
        citizens: Vec::new(),
        root,
        anchor: true,
    }))
}

/// Every project BAUD can seat: the anchor, its nested `projects/*`, and the
/// active roots its `AIPASS_ROOTS.json` declares. Nothing else on disk is
/// read: an undeclared sibling is not a project. Anchor first, the rest
/// alphabetical; deduped on the canonical root.
pub(crate) fn discover_projects(anchor: &Project) -> Vec<Project> {
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    seen.insert(
        anchor
            .root
            .canonicalize()
            .unwrap_or_else(|_| anchor.root.clone()),
    );

    let nested = fs::read_dir(anchor.root.join(PROJECTS_SUBDIR))
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with('.'))
        });
    // A declared root carrying two seals is refused: which one is the fleet
    // is not BAUD's to guess.
    let declared = declared_roots(&anchor.root)
        .into_iter()
        .filter(|root| registries_in(root).len() == 1);

    let mut found: Vec<Project> = nested
        .chain(declared)
        .filter(|dir| seen.insert(dir.canonicalize().unwrap_or_else(|_| dir.clone())))
        .filter_map(|dir| project_from_dir(&dir, false))
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    let mut projects = vec![anchor.clone()];
    projects.extend(found);
    projects
}

/// The seated project, defaulting to the anchor. Every command that reads
/// the filesystem resolves through here.
#[cfg(feature = "gui")]
pub(crate) fn active_project(state: &ActiveProject) -> Result<Project, String> {
    let seated = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    match seated {
        Some(project) => Ok(project),
        None => anchor_project(),
    }
}

/// A project named by the frontend, or the seated one when it names none.
///
/// The name is matched against BAUD's own census - the same door
/// [`project_switch`] uses - so a roster card can act in its own project's
/// scope without any command ever accepting a path from the webview. An
/// unknown name is an error, never a fallback to the seat: silently acting on
/// the wrong project is how an end-room kills a session nobody asked about.
#[cfg(feature = "gui")]
pub(crate) fn project_named(
    name: Option<&str>,
    state: &ActiveProject,
) -> Result<Project, String> {
    let Some(wanted) = name else {
        return active_project(state);
    };
    let anchor = anchor_project()?;
    discover_projects(&anchor)
        .into_iter()
        .find(|project| project.name == wanted)
        .ok_or_else(|| format!("no project named '{wanted}' in BAUD's census"))
}

/// The switcher menu: every discovered project, the seated one flagged.
#[cfg(feature = "gui")]
#[tauri::command]
pub fn list_projects(state: tauri::State<'_, ActiveProject>) -> Result<Vec<ProjectListing>, String> {
    let anchor = anchor_project()?;
    let active = active_project(&state)?;
    Ok(discover_projects(&anchor)
        .into_iter()
        .map(|project| ProjectListing {
            active: project.root == active.root,
            name: project.name,
            root: project.root.display().to_string(),
            anchor: project.anchor,
        })
        .collect())
}

/// Seat the fleet view in a discovered project. The name must match the
/// census exactly - there is deliberately no way to hand this command a path.
#[cfg(feature = "gui")]
#[tauri::command]
pub fn project_switch(name: String, state: tauri::State<'_, ActiveProject>) -> Result<(), String> {
    let anchor = anchor_project()?;
    let project = discover_projects(&anchor)
        .into_iter()
        .find(|project| project.name == name)
        .ok_or_else(|| format!("no discovered project named '{name}'"))?;

    *state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(project);
    Ok(())
}
