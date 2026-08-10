import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { BranchStatus, DirEntryInfo } from "../types";

interface FileTreeProps {
  branch: BranchStatus;
  /** Operator clicked a file: open it in a viewer tab. */
  onOpen: (path: string, name: string, branch: string) => void;
  onClose: () => void;
}

/**
 * The drawer a card's `files` button opens: that branch's directory as a
 * lazily-loaded tree. Reading only - every click either expands a directory
 * (one `list_dir` call, cached) or opens a file in a viewer tab. The backend
 * fences both commands to the AIPass root, so this component never needs to
 * police paths itself.
 */
export default function FileTree({ branch, onOpen, onClose }: FileTreeProps) {
  return (
    <aside className="baud-tree" aria-label={`${branch.name} files`}>
      <header className="baud-tree-head">
        <span className="baud-tree-title">{branch.name}</span>
        <button
          type="button"
          className="baud-tree-close"
          title="close the file tree"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className="baud-tree-body">
        <DirLevel path={branch.path} onOpen={(path, name) => onOpen(path, name, branch.name)} />
      </div>
    </aside>
  );
}

function DirLevel({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (path: string, name: string) => void;
}) {
  const [entries, setEntries] = useState<DirEntryInfo[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    invoke<DirEntryInfo[]>("list_dir", { path })
      .then((listing) => {
        if (mounted) setEntries(listing);
      })
      .catch((err) => {
        if (mounted) setFailure(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
    };
  }, [path]);

  if (failure) return <p className="baud-tree-error">{failure}</p>;
  if (entries === null) return <p className="baud-tree-loading">…</p>;
  if (entries.length === 0) return <p className="baud-tree-loading">empty</p>;

  return (
    <ul className="baud-tree-list">
      {entries.map((entry) =>
        entry.is_dir ? (
          <DirNode key={entry.path} entry={entry} onOpen={onOpen} />
        ) : (
          <li key={entry.path}>
            <button
              type="button"
              className="baud-tree-item baud-tree-file"
              title={entry.path}
              onClick={() => onOpen(entry.path, entry.name)}
            >
              {entry.name}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function DirNode({
  entry,
  onOpen,
}: {
  entry: DirEntryInfo;
  onOpen: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);

  return (
    <li>
      <button
        type="button"
        className="baud-tree-item baud-tree-dir"
        title={entry.path}
        onClick={toggle}
      >
        <span className="baud-tree-twist">{expanded ? "▾" : "▸"}</span>
        {entry.name}
      </button>
      {expanded ? <DirLevel path={entry.path} onOpen={onOpen} /> : null}
    </li>
  );
}
