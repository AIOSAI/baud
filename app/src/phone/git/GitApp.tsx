/** The git app: the wheel's door at repo grain and the card's GIT door at branch grain, as one stack of screens.
 * Reference: docs/phone/files-git.md */

import { useCallback, useEffect, useState } from "react";

import { gitRemote } from "../../host";
import type { GitRemote, GitRoot } from "../../types";
import FilesScreen from "../FilesScreen";
import { isMarkdownRef } from "../lib/markdown";
import { NO_REMOTE, noAgentLine, noRemote, rootAddress } from "../lib/gitWords";
import { splitPath } from "../lib/gitStatus";
import { useSystemBack } from "../lib/systemBack";
import { renderMarkdown } from "../Markdown";
import Reader from "../Reader";
import GitChangesScreen from "./GitChangesScreen";
import GitCommitScreen from "./GitCommitScreen";
import GitCommitsScreen from "./GitCommitsScreen";
import GitDiffScreen from "./GitDiffScreen";

/** An address without its scheme, for display only; the host stays because it decides where a tap lands. */
function plainly(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

function hostOf(url: string): string {
  return plainly(url).split("/")[0];
}

/** Which tree a read covers, in @api's spelling; `branch` is the server default and travels as an omitted parameter. */
export type GitGrain = "repo" | "branch";

export type GitView =
  | { kind: "sheet" }
  | { kind: "changes" }
  | { kind: "commits" }
  | { kind: "commit"; ref: string }
  /** `ref` is "" for the working tree, or the commit the file is read from. */
  | { kind: "diff"; path: string; ref: string }
  /** An untracked file, read through the files lane since git has no patch for it: branch-local, or under `root`. */
  | { kind: "file"; path: string; root?: GitRoot }
  /** An untracked directory at repo grain, browsed in the files door under `root`. */
  | { kind: "folder"; path: string; root: GitRoot };

interface GitAppProps {
  /** At repo grain an address for the tree; at branch grain the subject named on the title. */
  branch: string;
  project: string;
  /** `repo` opens on the sheet; `branch` opens straight into the changes list. Commits are repo-wide, so repo grain only. */
  grain?: GitGrain;
  projectLabel?: string;
  /** Repo grain only: the repo's changed-file count, or null before the slow lane answers (draws no number, never a zero). */
  changed?: number | null;
  /** Repo grain only: false means the fleet read has not landed, true means the project has no agent. */
  fleetAnswered?: boolean;
  /** Out of the app from the floor; `changesBack` names where that lands per grain. */
  onClose: () => void;
}

export default function GitApp({
  branch,
  project,
  grain = "repo",
  projectLabel = "",
  changed = null,
  fleetAnswered = false,
  onClose,
}: GitAppProps) {
  /* A lazy initializer, not an effect, so branch grain never paints the sheet for a frame. */
  const [stack, setStack] = useState<GitView[]>(() =>
    grain === "branch" ? [{ kind: "changes" }] : [{ kind: "sheet" }],
  );
  const view = stack[stack.length - 1];

  const changesBack = grain === "branch" ? "card" : "git";

  /* null `remote` with no `said` is a read in flight and draws nothing; an answer whose `remote` is null is "no remote" (`NO_REMOTE`); `said` is a refusal. */
  const [remote, setRemote] = useState<GitRemote | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    // A remote is a repository fact: at branch grain the request is never made.
    if (grain !== "repo" || !branch) return;
    let mounted = true;
    setRemote(null);
    setSaid(null);
    gitRemote(branch, project)
      .then((got) => {
        if (mounted) setRemote(got);
      })
      .catch((cause) => {
        if (mounted) setSaid(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, grain]);

  const push = useCallback((next: GitView) => setStack((held) => [...held, next]), []);
  // Decided outside the updater: React may run an updater twice, and `onClose` must not run twice.
  const back = useCallback(() => {
    if (stack.length > 1) setStack((held) => held.slice(0, -1));
    else onClose();
  }, [onClose, stack.length]);

  const home = useCallback(() => setStack((held) => held.slice(0, 1)), []);

  useSystemBack(back);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") back();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [back]);

  /* Undefined, never disabled: one floor above the entry `back` already lands home. */
  const onHome = stack.length > 2 ? home : undefined;

  if (view.kind === "changes") {
    return (
      <GitChangesScreen
        branch={branch}
        project={project}
        grain={grain}
        backLabel={changesBack}
        onOpenFile={(path) => push({ kind: "diff", path, ref: "" })}
        onReadFile={(path, root) => push(root ? { kind: "file", path, root } : { kind: "file", path })}
        onBrowse={(path, root) => push({ kind: "folder", path, root })}
        onBack={back}
      />
    );
  }

  if (view.kind === "folder") {
    const at = rootAddress(view.root);
    return (
      <FilesScreen
        branch={at.word}
        project=""
        root={at.root}
        at={view.path.replace(/\/+$/, "")}
        onOpenFile={(ref) => push({ kind: "file", path: ref.slice(at.word.length + 1), root: view.root })}
        backLabel="changes"
        onClose={back}
      />
    );
  }

  if (view.kind === "file") {
    const at = view.root ? rootAddress(view.root) : null;
    const word = at ? at.word : branch;
    return (
      <Reader
        target={{
          ref: `${word}/${view.path}`,
          title: `${word} · ${splitPath(view.path).name}`,
          kind: "file",
          // A root is not inside a project: the fence refuses `project` beside one.
          project: at ? "" : project,
          root: at?.root,
        }}
        preview={isMarkdownRef(view.path) ? renderMarkdown : undefined}
        onClose={back}
      />
    );
  }

  if (view.kind === "commits") {
    return (
      <GitCommitsScreen
        branch={branch}
        project={project}
        onOpenCommit={(ref) => push({ kind: "commit", ref })}
        onBack={back}
      />
    );
  }

  if (view.kind === "commit") {
    return (
      <GitCommitScreen
        branch={branch}
        project={project}
        commitRef={view.ref}
        onOpenFile={(path) => push({ kind: "diff", path, ref: view.ref })}
        onBack={back}
        onHome={onHome}
      />
    );
  }

  if (view.kind === "diff") {
    return (
      <GitDiffScreen
        branch={branch}
        project={project}
        grain={grain}
        path={view.path}
        commitRef={view.ref}
        onBack={back}
        onHome={onHome}
      />
    );
  }

  return (
    <section className="baud-phone-reader baud-git">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={back}>
          ‹ wheel
        </button>
        <span className="baud-phone-reader-title">
          {projectLabel} · <b className="baud-git-accent">GIT</b>
        </span>
      </header>

      <p className="baud-git-grain">whole repo — every branch, one working tree</p>

      {branch ? (
        <div className="baud-git-rows">
          <button type="button" className="baud-git-row" onClick={() => push({ kind: "changes" })}>
            <span className="baud-git-row-label">
              <b>changes</b>
              <span>uncommitted, across every branch</span>
            </span>
            {/* Absent until measured: a guessed zero would claim a clean tree. */}
            {changed === null ? null : <span className="baud-git-row-n">{changed}</span>}
            <span className="baud-git-row-go">›</span>
          </button>

          <button type="button" className="baud-git-row" onClick={() => push({ kind: "commits" })}>
            <span className="baud-git-row-label">
              <b>commits</b>
              <span>latest first — the repository's own history</span>
            </span>
            <span className="baud-git-row-go">›</span>
          </button>

          {/* Anchors, not buttons, so long-press and share work; no `›`, because no in-app floor is behind them. */}
          {remote?.web && !noRemote(remote) ? (
            <>
              <a
                className="baud-git-row baud-git-link"
                href={`${remote.web}/pulls`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="baud-git-row-label">
                  <b>
                    pull requests <i className="baud-git-out">↗</i>
                  </b>
                  <span>opens on {hostOf(remote.web)} — not browsed in-app</span>
                </span>
              </a>

              <a
                className="baud-git-row baud-git-link"
                href={`${remote.web}/issues`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="baud-git-row-label">
                  <b>
                    issues <i className="baud-git-out">↗</i>
                  </b>
                  <span>opens on {hostOf(remote.web)} — not browsed in-app</span>
                </span>
              </a>

              <a
                className="baud-git-row baud-git-link"
                href={remote.web}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="baud-git-row-label">
                  <b>
                    remote <i className="baud-git-out">↗</i>
                  </b>
                  <span>
                    {remote.remote} · {plainly(remote.web)}
                    {remote.redacted ? <i className="baud-git-quiet"> · password redacted</i> : null}
                  </span>
                </span>
              </a>
            </>
          ) : null}

          {/* A remote can be a local directory: the server sends `web: null`, so nothing tappable is drawn. */}
          {remote && !noRemote(remote) && !remote.web ? (
            <p className="baud-git-said">
              {remote.remote} · {remote.url}
              {remote.redacted ? " · password redacted" : ""}
              <span>this remote has no browsable form — there is no page to open</span>
            </p>
          ) : null}

          {remote && noRemote(remote) ? <p className="baud-git-said">{NO_REMOTE}</p> : null}

          {/* An older @api also sends "no remote" as a refusal, so it stays quiet, not red. */}
          {said ? <p className="baud-git-said">{said}</p> : null}
        </div>
      ) : (
        /* No citizen means no address for the tree; an empty list would read as a clean repository. */
        <p className="baud-phone-empty">{noAgentLine(fleetAnswered)}</p>
      )}

      <p className="baud-git-note">
        reads and lists live here; anything with a web home leaves for it — the phone browses no
        forge of its own
      </p>
    </section>
  );
}
