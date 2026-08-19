/**
 * THE GIT APP - the phone's fourth-wheel app (DPLAN-0303), and since 08-17 the
 * agent card's git door as well.
 *
 * AN APP IS NOT AN AGENT, and that is still why the wheel grew a fourth layer.
 * Every other door on that face is addressed to somebody - a card, a room, a
 * passport, a memory - and the repository they all live in belongs to nobody,
 * so it has nowhere to hang on a rail made of citizens.
 *
 * TWO GRAINS, ONE APP (Patrick, 08-17: "it should open just like this but show
 * only the agent local changes"). The card's GIT tile used to open a raw
 * whole-branch patch - one unhighlighted wall of text - and his ruling is that
 * it should open THE SAME grouped list, tap a file, read the patch flow this
 * app already ships, narrowed to that one citizen's working tree.
 *
 * SO THE GRAIN IS A PROP, NOT A SECOND COMPONENT. A copy of these screens
 * scoped to a branch would be the same four reads, the same refusal voice and
 * the same grouping rule written twice, and the second copy is where the two
 * start disagreeing about what a changed file looks like. What the grain
 * changes is small and named in one place each: which floor the stack starts
 * on, what the changes screen asks the server for, and how deep a group cuts.
 *
 * WHY THE STACK LIVES HERE. Five screens reach each other in one direction and
 * come back one level at a time, and the per-file diff is reachable from two
 * places (a changed file, and a file inside a commit) which means "back" is a
 * question about where you came FROM, not about which screen you are on. A
 * stack answers that by construction; five booleans in PhoneApp would have to
 * re-derive it, and would get it wrong the first time a sixth screen appeared.
 *
 * NOTHING IS HELD ACROSS A CLOSE. Every screen reads on mount, so re-opening
 * the app is a fresh read rather than a picture of a working tree that has
 * moved on. A phone in a pocket is out of date by definition; the fix is to
 * read again, not to cache harder.
 *
 * AND SINCE 08-17 THERE ARE ROWS THAT LEAVE (DPLAN-0303 phase 4). Pull
 * requests, issues and the remote are the forge's pages, not this app's
 * screens: they are anchors, they open a browser tab, and they act on the first
 * tap rather than pushing a floor onto the stack. They exist at REPO grain
 * only - a remote belongs to the repository, so the branch-grain door the
 * card's tile opens neither shows them nor asks for them.
 */

import { useCallback, useEffect, useState } from "react";

import { gitRemote } from "../../host";
import type { GitRemote } from "../../types";
import GitChangesScreen from "./GitChangesScreen";
import GitCommitScreen from "./GitCommitScreen";
import GitCommitsScreen from "./GitCommitsScreen";
import GitDiffScreen from "./GitDiffScreen";

/**
 * An address as a person reads it off a card, with the scheme taken off.
 *
 * A DISPLAY TRIM AND NOTHING ELSE - every `href` on this screen carries the
 * server's `web` untouched. The HOST STAYS: it is the fact that decides where a
 * tap lands, and a line reading `AIOSAI/AIPass` would look identical whether
 * the remote points at github or at a box in somebody's basement.
 */
function plainly(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

/** Which forge a link leaves for, said in the row that leaves for it. */
function hostOf(url: string): string {
  return plainly(url).split("/")[0];
}

/**
 * WHICH TREE A READ WAS TAKEN OVER - @api's own word, in @api's own spelling.
 *
 * `repo` is every branch in the checkout at once, which is the wheel app's
 * question and nobody else's. `branch` is one citizen's own subtree, which is
 * what the card, the badge sweep and the files screen have always meant - and
 * it is the server's DEFAULT, so it travels as an omitted parameter rather than
 * a spelled-out one (see the changes screen, which is the only caller).
 *
 * The union lives here because this component is what a grain decides the shape
 * of; the two screens that read it take it as a prop rather than inventing a
 * second vocabulary for the same fact.
 */
export type GitGrain = "repo" | "branch";

/**
 * One screen in the app, with everything that screen needs to be re-rendered
 * from nothing. No screen reads state off the one below it.
 */
export type GitView =
  | { kind: "sheet" }
  | { kind: "changes" }
  | { kind: "commits" }
  | { kind: "commit"; ref: string }
  /** `ref` is "" for the working tree, or the commit the file is read from. */
  | { kind: "diff"; path: string; ref: string };

interface GitAppProps {
  /**
   * THE CITIZEN, and what it names depends on the grain.
   *
   * At `repo` grain it is an ADDRESS FOR THE TREE and nothing about the branch
   * itself is shown anywhere. At `branch` grain it is the SUBJECT: the tree
   * being read is its own, and its name is on the title.
   */
  branch: string;
  /** The project, as a census name. "" means the anchor project. */
  project: string;
  /**
   * WHICH TREE, and it is the app's shape rather than one query parameter.
   *
   * `repo` (the default, and the wheel app's whole reason) opens on the sheet -
   * a door to changes, a door to commits. `branch` opens STRAIGHT INTO THE
   * CHANGES LIST, because a card's git tile is a question about local changes
   * and a sheet between the tap and the answer would be a screen that exists
   * only to be passed through. Commits stay a wheel-app thing: a commit is
   * repo-wide by construction, so there is no such thing as this branch's.
   */
  grain?: GitGrain;
  /**
   * REPO GRAIN ONLY - what the sheet's title calls the project, as the operator
   * picked it. The branch-grain flow never renders a sheet, so it names none.
   */
  projectLabel?: string;
  /**
   * REPO GRAIN ONLY, and the sheet is its only reader. How many changed files
   * the repo holds, from PhoneApp's slow lane - or null when that lane has not
   * answered yet. Null draws no number at all; a zero here would be a claim
   * ("nothing has changed") that nothing has measured.
   */
  changed?: number | null;
  /**
   * Out of the app from the floor - and the floor is the grain's, so this means
   * two different destinations. See `changesBack` in the body, which is the
   * word the operator is shown for whichever one it is.
   */
  onClose: () => void;
}

export default function GitApp({
  branch,
  project,
  grain = "repo",
  projectLabel = "",
  changed = null,
  onClose,
}: GitAppProps) {
  /* THE FLOOR IS THE GRAIN'S, decided once when the app opens. A lazy
     initializer rather than an effect: the first render must already be on the
     right screen, or the branch-grain flow would paint a sheet for one frame -
     a flash of a screen this door does not have. */
  const [stack, setStack] = useState<GitView[]>(() =>
    grain === "branch" ? [{ kind: "changes" }] : [{ kind: "sheet" }],
  );
  const view = stack[stack.length - 1];

  /* WHAT THE FLOOR'S BACK CHIP RETURNS TO, in the one word that is true of it.
     At repo grain the floor is the sheet and back leaves for the wheel the app
     hangs on; at branch grain the floor is the changes list and back leaves for
     the card the tile was pressed on - PhoneApp re-opens it, so the word and
     what happens are the same thing. The changes screen is BOTH a floor and a
     first storey depending on grain, which is why it is told rather than
     guessing. */
  const changesBack = grain === "branch" ? "card" : "git";

  /* WHERE THE ROWS THAT LEAVE COME FROM. Two absences, and they are not the
     same absence: `remote` null with nothing said is a read still in the air,
     and `said` is the server's own sentence about why there will never be one.
     The first draws NOTHING - a skeleton link is a promise this face has not
     been given yet - and the second draws that sentence where the links would
     have been. */
  const [remote, setRemote] = useState<GitRemote | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    /* REPO GRAIN ONLY, and the request is not merely hidden at branch grain -
       it is never made. A remote is a repository fact; asking for one on the
       card's door would be this app reading something it has decided not to
       show. No citizen means no address to resolve, so that asks nothing
       either. */
    if (grain !== "repo" || !branch) return;
    let mounted = true;
    setRemote(null);
    setSaid(null);
    gitRemote(branch, project)
      .then((got) => {
        if (mounted) setRemote(got);
      })
      .catch((cause) => {
        // The server's sentence, unreworded - it is the only thing on this
        // screen that knows whether the repository has a forge at all.
        if (mounted) setSaid(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, grain]);

  const push = useCallback((next: GitView) => setStack((held) => [...held, next]), []);
  /**
   * One level up, and out of the app from the floor - the back chip's whole
   * contract, and Escape's, so the key and the button can never disagree.
   *
   * The decision is made OUT HERE rather than inside the updater: an updater
   * that called the parent's `onClose` would be a side effect in a place React
   * is entitled to run twice, and "close" is not a thing to do twice.
   */
  const back = useCallback(() => {
    if (stack.length > 1) setStack((held) => held.slice(0, -1));
    else onClose();
  }, [onClose, stack.length]);

  /**
   * THE WHOLE WAY BACK IN ONE TAP (Patrick, 08-17: "I have to go back back
   * back... I should be able to return to the entry point").
   *
   * The floor, whatever the floor is - `slice(0, 1)` keeps the screen the app
   * OPENED on rather than a screen named here, so the wheel's door lands on its
   * sheet and the card's tile lands on its changes list, and neither can ever
   * land somewhere the operator did not come in through. It never leaves the
   * app: that is `back` from the floor, and this chip is not another way out.
   */
  const home = useCallback(() => setStack((held) => held.slice(0, 1)), []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") back();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [back]);

  /* DRAWN ONLY WHERE IT DOES SOMETHING `back` DOESN'T. One floor above the
     entry, back IS home, and two chips onto one screen is a second control that
     answers a question the operator hasn't got. From two floors up it replaces
     the repeated taps that earned the chip. UNDEFINED, NEVER DISABLED - this
     face draws no dead controls, so the depth decides whether the chip exists
     at all rather than whether it responds.

     Only the two screens that CAN sit that deep are offered it: at repo grain a
     commit is two floors up and a diff is two or three, while changes and
     commits are the sheet's own storey and can never be more. A prop on those
     would be a promise nothing can keep. */
  const onHome = stack.length > 2 ? home : undefined;

  if (view.kind === "changes") {
    return (
      <GitChangesScreen
        branch={branch}
        project={project}
        grain={grain}
        backLabel={changesBack}
        onOpenFile={(path) => push({ kind: "diff", path, ref: "" })}
        onBack={back}
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

      {/* THE GRAIN, SAID OUT LOUD AND FIRST. Every number under this line is
          measured over the whole repository - which in this fleet means every
          branch at once, not the one that happens to be under the notch. A
          count that big is only honest if the screen says what it counted. */}
      <p className="baud-git-grain">whole repo — every branch, one working tree</p>

      {branch ? (
        <div className="baud-git-rows">
          <button type="button" className="baud-git-row" onClick={() => push({ kind: "changes" })}>
            <span className="baud-git-row-label">
              <b>changes</b>
              <span>uncommitted, across every branch</span>
            </span>
            {/* Absent until measured. A badge that guesses zero would say the
                tree is clean on the strength of a read that never happened. */}
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

          {/* THE ROWS THAT LEAVE. Anchors, not buttons: a link-card opens the
              forge on the first tap, so it is a link in the markup as well as
              in the design - which is what gives it long-press, share, open-in-
              background and everything else a phone already knows how to do
              with an address. No `›`: that chevron means "another floor of this
              app", and there is no floor behind these. */}
          {remote?.web ? (
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
                  {/* NO COUNT HERE, and its absence is the honest one: how many
                      are open is a question for the forge's API with the
                      operator's own credentials, and this lane read a config
                      file. A number would have to be invented to appear. */}
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
                    {/* SAID, NEVER SILENT. The configured URL carried a
                        credential and the server took it out; the browsable
                        address on this row never had one to take. Either way
                        the operator is entitled to know it was there. */}
                    {remote.redacted ? <i className="baud-git-quiet"> · password redacted</i> : null}
                  </span>
                </span>
              </a>
            </>
          ) : null}

          {/* A REMOTE WITH NO PAGE. Real: a remote can be a directory on this
              disk, and the server answers `web: null` rather than putting a
              scheme in front of a path. So the fact is shown and nothing is
              drawn that could be tapped - a dead card is worse than no card. */}
          {remote && !remote.web ? (
            <p className="baud-git-said">
              {remote.remote} · {remote.url}
              {remote.redacted ? " · password redacted" : ""}
              <span>this remote has no browsable form — there is no page to open</span>
            </p>
          ) : null}

          {/* THE SERVER'S OWN SENTENCE, WHERE THE LINKS WOULD HAVE BEEN. A
              repository with no remote configured is the common case here (two
              projects in this tree have none), and it is not an error worth a
              red box - it is an answer. */}
          {said ? <p className="baud-git-said">{said}</p> : null}
        </div>
      ) : (
        /* No citizen means no address for the tree. Said plainly rather than
           drawn as an empty list, which would read as a clean repository. */
        <p className="baud-phone-empty">
          no citizen named yet — the fleet read has not landed, so there is nothing to name the
          repository with
        </p>
      )}

      {/* THE DIVIDE THIS SCREEN IS BUILT ON, said once at the bottom of it.
          What can be read from the machine is read here; what lives on the web
          is LEFT FOR. The phone browses no forge - it links to one - so the
          counts beside the mock's link rows are not missing from this build,
          they are the other side of that line. */}
      <p className="baud-git-note">
        reads and lists live here; anything with a web home leaves for it — the phone browses no
        forge of its own
      </p>
    </section>
  );
}
