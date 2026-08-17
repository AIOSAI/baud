/**
 * The files door, phone-shaped: one directory level at a time.
 *
 * The desktop's FileTree holds a whole expanding tree in a side pane; a phone
 * screen holds one level and a thumb, so this browses the way a file manager
 * app does - tap a directory to enter it, `‹ up` to leave it, tap a file to
 * read it in the Reader that already exists.
 *
 * PATHS ARE NAMES HERE, same doctrine as the Reader: everything this screen
 * sends is `<branch>/<relative>`, everything it gets back is relative to the
 * branch root, and the server's fence refuses `..` and absolute shapes. The
 * noise filter (.git, node_modules, .venv...) is the server's, mirrored from
 * the desktop tree - machine residue, not content.
 */

import { useEffect, useState } from "react";

import { listDirWindow } from "../host";
import { HostError } from "../host/transport.http";
import type { DirEntryInfo } from "../types";

interface FilesScreenProps {
  /** The branch whose tree this browses. */
  branch: string;
  /** Which project that branch lives in - browsing is free across projects
   *  since 2026-08-16. Empty means the seat, the pre-ruling meaning. */
  project: string;
  /** A file was tapped - open it in the Reader, over this screen. */
  onOpenFile: (ref: string, title: string) => void;
  onClose: () => void;
}

export default function FilesScreen({ branch, project, onOpenFile, onClose }: FilesScreenProps) {
  /** Where we are, relative to the branch root. "" is the root itself. */
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<DirEntryInfo[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setEntries(null);
    setError(null);
    listDirWindow(dir ? `${branch}/${dir}` : branch, project)
      .then((got) => {
        if (!mounted) return;
        setEntries(got.entries);
        setTruncated(got.truncated);
      })
      .catch((cause) => {
        if (!mounted) return;
        // @api's sentence, verbatim - the fence's refusals name themselves.
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, dir]);

  /** One level back, or out of the screen from the root - the same button. */
  const up = () => {
    if (!dir) {
      onClose();
      return;
    }
    const cut = dir.lastIndexOf("/");
    setDir(cut < 0 ? "" : dir.slice(0, cut));
  };

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={up}>
          ‹ {dir ? "up" : "back"}
        </button>
        <span className="baud-phone-reader-title">
          {branch}/{dir}
        </span>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && entries === null ? <p className="baud-phone-empty">listing…</p> : null}
      {truncated ? (
        <p className="baud-phone-truncated">
          long directory - the server dropped the tail of this level
        </p>
      ) : null}

      {entries !== null ? (
        <div className="baud-phone-files">
          {entries.length === 0 ? <p className="baud-phone-empty">empty directory</p> : null}
          {entries.map((entry: DirEntryInfo) => (
            <button
              key={entry.path}
              type="button"
              className={`baud-phone-file ${entry.is_dir ? "baud-phone-file-dir" : ""}`}
              onClick={() =>
                entry.is_dir
                  ? setDir(entry.path)
                  : onOpenFile(`${branch}/${entry.path}`, `${branch} · ${entry.name}`)
              }
            >
              {entry.name}
              {entry.is_dir ? "/" : ""}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
