import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects, projectSwitch } from "../host";

import type { ProjectListing } from "../types";

/**
 * The seat selector: lists the backend's sealed projects and reseats by name.
 * It switches by name only; the backend owns discovery and never takes a path from here.
 */
export default function ProjectSwitch({
  project,
  onSwitched,
  onNewProject,
}: {
  /** The seated project's name, from the latest snapshot. */
  project: string | null;
  /** Fired after a successful switch so the app can reseat immediately. */
  onSwitched: () => void;
  /** The menu's last row: the app opens the new-project sheet. */
  onNewProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<ProjectListing[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setListing(null);
    setFailure(null);
    try {
      setListing(await listProjects());
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }, [open]);

  const choose = useCallback(
    async (name: string) => {
      try {
        await projectSwitch(name);
        setOpen(false);
        onSwitched();
      } catch (err) {
        setFailure(err instanceof Error ? err.message : String(err));
      }
    },
    [onSwitched],
  );

  return (
    <div className="baud-project" ref={rootRef}>
      <button
        type="button"
        className="baud-project-chip"
        title="switch project"
        onClick={() => void toggle()}
      >
        {project ?? "…"}
        <span className="baud-project-caret">▾</span>
      </button>

      {open ? (
        <div className="baud-project-menu" role="menu">
          {failure ? <div className="baud-project-fail">{failure}</div> : null}
          {listing === null && !failure ? (
            <div className="baud-project-fail">scanning…</div>
          ) : null}
          {(listing ?? []).map((entry) => (
            <button
              key={entry.root}
              type="button"
              role="menuitem"
              className={`baud-project-item ${entry.active ? "baud-project-item-active" : ""}`}
              title={entry.root}
              onClick={() => void choose(entry.name)}
            >
              <span className="baud-project-item-name">{entry.name}</span>
              {entry.anchor ? <span className="baud-project-item-tag">anchor</span> : null}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="baud-project-item baud-project-item-new"
            title="create a project from a template, then seat it and start its manager"
            onClick={() => {
              setOpen(false);
              onNewProject();
            }}
          >
            <span className="baud-project-item-name">+ new project</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
