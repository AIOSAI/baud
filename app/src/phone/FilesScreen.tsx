/** The FILES app, phone-shaped: one directory level at a time. Reference: docs/phone/files-git.md */

import { useEffect, useMemo, useRef, useState } from "react";

import { gitChangeRows, listDirWindow } from "../host";
import { HostError } from "../host/transport.http";
import type { DirEntryInfo } from "../types";
import { NO_FLOOR, copyShown, copyThrough, machinePath } from "./lib/copyPath";
import { type DirListing, countLine, firstPage, moreLabel, nextOffset, withPage } from "./lib/dirPages";
import { chipOf, type GitChip } from "./lib/gitStatus";
import { useSystemBack } from "./lib/systemBack";
import { CopyByHand } from "./Reader";

const GONE_ANSWER = "deleted - there is no file left to open";

export const NO_CHIPS_HERE = "git status is not shown here";

interface FilesScreenProps {
  branch: string;
  /** The branch's project; empty means the seat. */
  project: string;
  /** Which kind of word `branch` is (`home`, `project`, `aipass`, `branch`); empty is sent as an absent key. */
  root?: string;
  /** Where the browse starts (its floor), relative to the branch root; "" is the branch itself. */
  start?: string;
  /** Where the browse opens, so a file's `‹ back` lands in its folder; must sit at or under `start`. */
  at?: string;
  onOpenFile: (ref: string, title: string, at: string) => void;
  /** The word after `‹` at the floor, from the trail that opened it; below the floor the chip says `up`. */
  backLabel?: string;
  onClose: () => void;
}

type FileRow =
  | { kind: "entry"; entry: DirEntryInfo; chip: GitChip | null; inside: boolean }
  | { kind: "gone"; path: string; name: string };

export default function FilesScreen({
  branch,
  project,
  root = "",
  start = "",
  at,
  onOpenFile,
  backLabel = "back",
  onClose,
}: FilesScreenProps) {
  const [dir, setDir] = useState(() => (at !== undefined && isAtOrUnder(at, start) ? at : start));
  const [listing, setListing] = useState<DirListing | null>(null);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed by branch-local path, the space `entry.path` is spelled in. null: not answered.
  const [changed, setChanged] = useState<ReadonlyMap<string, GitChip> | null>(null);
  const [said, setSaid] = useState<{ path: string; text: string; byHand?: string } | null>(null);
  const [floor, setFloor] = useState("");
  // The copied mark does not time out: the clipboard still holds the path. It clears
  // when the level changes, so it cannot land on a same-named file elsewhere.
  const [copied, setCopied] = useState<string | null>(null);

  const where = dir ? `${branch}/${dir}` : branch;
  // A page that lands after the level changed belongs to the old level.
  const level = useRef("");
  level.current = `${project}\u0000${root}\u0000${where}`;

  useEffect(() => {
    let mounted = true;
    setListing(null);
    setPaging(false);
    setPageError(null);
    setError(null);
    setSaid(null);
    setCopied(null);
    setFloor("");
    listDirWindow(where, project, root)
      .then((got) => {
        if (!mounted) return;
        setListing(firstPage(got));
        setFloor(got.floor ?? "");
      })
      .catch((cause) => {
        if (!mounted) return;
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [where, project, root]);

  // One fetch per screen: `dir` is deliberately absent, the change set belongs to the
  // branch. A refusal is quiet - the listing stays true without git.
  useEffect(() => {
    let mounted = true;
    setChanged(null);
    // Chips are off outside a branch root: the rows lane is keyed by a branch, and a
    // root's name sent there could paint a same-named citizen's changes over these files.
    if (root && root !== "branch") {
      return () => {
        mounted = false;
      };
    }
    gitChangeRows(branch, project)
      .then((got) => {
        if (!mounted) return;
        const held = new Map<string, GitChip>();
        for (const row of got.rows) {
          const chip = chipOf(row.status);
          // `git rm --cached x` reports one path twice (deleted + untracked); untracked
          // is the true word for a row you can still tap, so 'U' wins a repeat.
          if (!held.has(row.path) || chip === "U") held.set(row.path, chip);
        }
        setChanged(held);
      })
      .catch(() => {
        // A refusal is quiet: the listing paints plain.
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, root]);

  const entries = listing?.entries ?? null;
  const more = listing?.more ?? false;
  const rows = useMemo(() => buildRows(entries, changed, dir, more), [entries, changed, dir, more]);
  const offset = listing ? nextOffset(listing) : null;
  const count = listing ? countLine(listing) : null;

  const showMore = () => {
    if (offset === null || paging) return;
    const asked = level.current;
    setPaging(true);
    setPageError(null);
    listDirWindow(where, project, root, offset)
      .then((got) => {
        if (level.current !== asked) return;
        setListing((held) => (held ? withPage(held, got) : held));
      })
      .catch((cause) => {
        if (level.current !== asked) return;
        setPageError(cause instanceof HostError ? cause.message : String(cause));
      })
      .finally(() => {
        if (level.current === asked) setPaging(false);
      });
  };

  const up = () => {
    if (dir === start) {
      onClose();
      return;
    }
    const cut = dir.lastIndexOf("/");
    const next = cut < 0 ? "" : dir.slice(0, cut);
    setDir(next.length < start.length ? start : next);
  };

  const home = () => setDir(start);

  useSystemBack(up);

  const copy = async (path: string) => {
    setSaid(null);
    setCopied(null);
    const machine = machinePath(floor, path);
    if (!machine) {
      setSaid({ path, text: NO_FLOOR });
      return;
    }
    // `copyThrough` reaches `execCommand` before its first await, so the copy runs inside the tap.
    const shown = copyShown(await copyThrough(machine), machine);
    if (shown.copied) setCopied(path);
    if (shown.note) setSaid({ path, text: shown.note, byHand: shown.byHand ?? undefined });
  };

  const below = dir === start ? 0 : dir.slice(start.length).split("/").filter(Boolean).length;

  const title = branch || root || "files";

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={up}>
          ‹ {dir === start ? backLabel : "up"}
        </button>
        {below >= 2 ? (
          <button type="button" className="baud-phone-home" onClick={home}>
            ⌂ home
          </button>
        ) : null}
        <span className="baud-phone-reader-title">
          {title}
          {dir ? `/${dir}` : ""}
        </span>
      </header>

      {root && root !== "branch" ? <p className="baud-phone-files-quiet">{NO_CHIPS_HERE}</p> : null}

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && entries === null ? <p className="baud-phone-empty">listing…</p> : null}
      {count ? <p className="baud-phone-files-quiet">{count}</p> : null}

      {entries !== null ? (
        <div className="baud-phone-files">
          {rows.length === 0 ? <p className="baud-phone-empty">empty directory</p> : null}
          {rows.map((row) =>
            row.kind === "gone" ? (
              /* Pressable, never `disabled`: a disabled button on touch gives no answer. */
              <div key={row.path} className="baud-phone-file-block">
                <div className="baud-phone-file-row baud-phone-file-gone">
                  <button
                    type="button"
                    className="baud-phone-file"
                    onClick={() =>
                      setSaid(
                        said?.path === row.path && said.text === GONE_ANSWER
                          ? null
                          : { path: row.path, text: GONE_ANSWER },
                      )
                    }
                  >
                    <span className="baud-phone-file-name">{row.name}</span>
                  </button>
                  <CopyButton done={copied === row.path} onCopy={() => copy(row.path)} />
                  <span className="baud-phone-file-chip">D</span>
                </div>
                {said?.path === row.path ? <p className="baud-phone-said">{said.text}</p> : null}
                {said?.path === row.path && said.byHand ? <CopyByHand text={said.byHand} /> : null}
              </div>
            ) : (
              <div key={row.entry.path} className="baud-phone-file-block">
                <div
                  /* The row wears the status class, not the button: the chip draws its
                     border in `currentColor` and inherits from this common parent. */
                  className={`baud-phone-file-row ${row.entry.is_dir ? "baud-phone-file-dir" : ""} ${
                    row.chip ? `baud-phone-file-${row.chip}` : ""
                  } ${row.inside ? "baud-phone-file-inside" : ""}`}
                >
                  <button
                    type="button"
                    className="baud-phone-file"
                    onClick={() =>
                      row.entry.is_dir
                        ? setDir(row.entry.path)
                        : onOpenFile(
                            `${branch}/${row.entry.path}`,
                            `${title} · ${row.entry.name}`,
                            dir,
                          )
                    }
                  >
                    <span className="baud-phone-file-name">
                      {row.entry.name}
                      {row.entry.is_dir ? "/" : ""}
                    </span>
                  </button>
                  <CopyButton done={copied === row.entry.path} onCopy={() => copy(row.entry.path)} />
                  {/* One slot on every row, even empty, so the copy button lands in the same
                      column down the listing. */}
                  <span
                    className={
                      row.chip
                        ? "baud-phone-file-chip"
                        : row.inside
                          ? "baud-phone-file-dot"
                          : "baud-phone-file-slot"
                    }
                  >
                    {row.chip}
                  </span>
                </div>
                {said?.path === row.entry.path ? (
                  <p className="baud-phone-said">{said.text}</p>
                ) : null}
                {said?.path === row.entry.path && said.byHand ? <CopyByHand text={said.byHand} /> : null}
              </div>
            ),
          )}
          {pageError ? <p className="baud-phone-error">{pageError}</p> : null}
          {offset !== null && listing ? (
            <button type="button" className="baud-phone-files-more" onClick={showMore}>
              {paging ? "listing…" : moreLabel(listing)}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The copy button one row wears - a sibling of the row's button, since a button inside a button is invalid HTML. */
function CopyButton({ done, onCopy }: { done: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      className={`baud-phone-copy ${done ? "baud-phone-copy-done" : ""}`}
      onClick={onCopy}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/** The listing with git folded in; a wholly new directory arrives as `dir/` (no `-uall`), so its files read plain. */
function buildRows(
  entries: DirEntryInfo[] | null,
  changed: ReadonlyMap<string, GitChip> | null,
  dir: string,
  more: boolean,
): FileRow[] {
  if (entries === null) return [];

  const rows: FileRow[] = entries.map((entry) => ({
    kind: "entry",
    entry,
    chip: entry.is_dir || changed === null ? null : (changed.get(entry.path) ?? null),
    inside: entry.is_dir && changed !== null && holdsChange(changed, entry.path),
  }));

  // No gone rows off a partial listing: the file may sit in a page not yet asked for.
  if (changed === null || more) return rows;

  const prefix = dir ? `${dir}/` : "";
  const listed = new Set(entries.map((entry) => entry.path));

  for (const [path, chip] of changed) {
    if (chip !== "D") continue;
    if (listed.has(path)) continue;
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (name === "" || name.includes("/")) continue;
    rows.splice(placeOf(rows, name), 0, { kind: "gone", path, name });
  }

  return rows;
}

/** Whether anything git named lives beneath `dir`; the trailing slash keeps `src` from claiming `srcgen/`. */
function holdsChange(changed: ReadonlyMap<string, GitChip>, dir: string): boolean {
  const under = `${dir}/`;
  for (const path of changed.keys()) {
    if (path.startsWith(under)) return true;
  }
  return false;
}

/** Where a deleted file's row belongs, by /v1/dir's own order: directories first, then files by lower-cased name. */
function placeOf(rows: FileRow[], name: string): number {
  const key = name.toLowerCase();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind === "entry" && row.entry.is_dir) continue;
    const other = row.kind === "entry" ? row.entry.name : row.name;
    if (other.toLowerCase() > key) return i;
  }
  return rows.length;
}

function isAtOrUnder(level: string, floor: string): boolean {
  return !floor || level === floor || level.startsWith(`${floor}/`);
}
