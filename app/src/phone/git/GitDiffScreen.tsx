/**
 * ONE FILE'S PATCH - the end of every path through the git app.
 *
 * ONE FILE AT A TIME, BY DESIGN, and the design is @api's as much as this
 * face's: the diff lane cuts a single file's block out of the patch and refuses
 * over 512KB rather than truncating, because half a patch is not a small patch,
 * it is a broken one. A commit's whole diff never crosses the wire at all.
 *
 * THE RENDERER IS `react-diff-view` (MIT), and it consumes exactly what the
 * server sends: raw unified diff text, parsed here, one file rendered. Writing
 * a diff renderer by hand is writing a unified-diff parser by hand - hunk
 * headers, no-newline markers, renames, binary files - and every one of those
 * edge cases is a wrong picture of a real change rather than a crash.
 *
 * THE CONTEXT WIDTH IS THREE LINES, NOT THE MOCK'S ONE. The lane routes through
 * drone's diff door, which recognises no -U passthrough, so three is what the
 * door generates. The mock preferred one and the honest thing is to ship what
 * exists: a narrower context has been asked for upstream and this screen will
 * inherit it the day it lands, with nothing here to change.
 */

import { Fragment, useEffect, useState } from "react";
import { Decoration, Diff, Hunk, parseDiff } from "react-diff-view";
import type { FileData } from "react-diff-view";
// The library's own stylesheet, retuned to this face's tokens in phone.css -
// it exposes every colour as a `--diff-*` custom property, so the phone's
// palette drives it instead of a second set of hexes being pasted over it.
import "react-diff-view/style/index.css";

import { gitFileDiff } from "../../host";
import type { GitFileDiff } from "../../types";
import type { GitGrain } from "./GitApp";
import { splitPath } from "../lib/gitStatus";

interface GitDiffScreenProps {
  branch: string;
  project: string;
  /**
   * The grain the PATH was spelled at, which is the only thing this screen uses
   * it for. A repo-relative path read at branch grain names nothing, and a
   * branch-relative one read at repo grain names the wrong file or no file at
   * all - so the grain has to travel with the path it belongs to rather than
   * being assumed here.
   */
  grain: GitGrain;
  /** The file, spelled exactly as the list that linked here spelled it. */
  path: string;
  /** The commit to read it out of, or "" for the working tree. */
  commitRef: string;
  onBack: () => void;
  /**
   * Straight to the floor the app opened on - or ABSENT when this screen is
   * only one floor above it, because then `back` already lands there and a
   * second chip onto the same screen says nothing. The app owns the stack, so
   * the app is what knows; this screen only draws what it was handed.
   */
  onHome?: () => void;
}

export default function GitDiffScreen({
  branch,
  project,
  grain,
  path,
  commitRef,
  onBack,
  onHome,
}: GitDiffScreenProps) {
  const [patch, setPatch] = useState<GitFileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setPatch(null);
    setError(null);
    gitFileDiff({
      branch,
      project,
      path,
      // A commit is repo-wide by construction and the lane refuses a grain
      // beside a ref - so the grain is named only for the working tree, where
      // it is the difference between this repository and one branch of it.
      //
      // AND BRANCH GRAIN IS NAMED BY NOT NAMING IT: the server's default for
      // this lane is the branch's own tree, and the transport drops an empty
      // value, so the request that leaves here is the one the phone's other
      // read lanes have always sent. Spelling it out would be a second way to
      // say the default, and the two spellings drift the day the default does.
      grain: commitRef || grain === "branch" ? "" : "repo",
      ref: commitRef,
    })
      .then((got) => {
        if (mounted) setPatch(got);
      })
      .catch((cause) => {
        // VERBATIM, and this screen is where that matters most. "No changes to
        // X in this patch" is what a tap on a stale list earns, and an
        // untracked file earns it too - git's own diff cannot see a file it has
        // never seen, so a `??` row has no patch to show and the server says so
        // in a sentence a person can act on.
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
    // The grain is a dependency because it CHANGES THE ANSWER, exactly as the
    // project does: the same path asked at two grains is two different reads.
  }, [branch, project, grain, path, commitRef]);

  const { dir, name } = splitPath(path);
  /* PARSED ONCE PER PATCH, and an unparsed patch is not an empty screen - see
     the fallback below. `parseDiff` answers with one entry per file; this lane
     sends one file, so the first entry IS the answer.
     A FILE WITH NO HUNKS COUNTS AS UNRENDERABLE, which is not pedantry: a
     binary file and a mode-only change both parse perfectly into zero hunks,
     and rendering them would draw an empty bordered box under a filename. The
     patch text says what happened in both cases, so the fallback shows it. */
  const parsed: FileData | null = patch ? (parseDiff(patch.diff)[0] ?? null) : null;
  const file = parsed && parsed.hunks.length > 0 ? parsed : null;

  return (
    <section className="baud-phone-reader baud-git">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onBack}>
          ‹ back
        </button>
        {onHome ? (
          <button type="button" className="baud-phone-home" onClick={onHome}>
            ⌂ home
          </button>
        ) : null}
        <span className="baud-phone-reader-title">{name}</span>
      </header>

      <div className="baud-git-difhead">
        <b>
          {dir ? <i>{dir}</i> : null}
          {name}
        </b>
        {patch ? (
          <p className="baud-git-difsub">
            {patch.bytes} bytes
            {patch.ref ? ` · ${patch.ref}` : " · working tree"}
            {" · 3 lines of context"}
          </p>
        ) : null}
      </div>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && patch === null ? <p className="baud-phone-empty">reading…</p> : null}

      {/* THE SERVER'S OWN HONESTY FLAG, passed straight through. It only fires
          on a whole-tree patch - a single file over the cap is refused outright
          - so seeing this here means the lane changed shape, and it says so
          rather than letting a cut patch read as a complete one. */}
      {patch?.truncated ? (
        <p className="baud-phone-truncated">
          the server capped this patch — what follows is the beginning of it, not all of it
        </p>
      ) : null}

      {patch && file ? (
        <div className="baud-git-diff">
          <Diff diffType={file.type} hunks={file.hunks} viewType="unified">
            {/* THE HUNK HEADER IS A DECORATION, not part of the hunk - the
                library renders changes and leaves the `@@` line to the caller.
                It is not decoration in the ornamental sense and it is not
                optional: without it two hunks run together, the line numbers
                jump, and nothing on screen says why. On a phone, where only a
                few lines of context are visible at once, that marker is most of
                what tells you where in the file you are. */}
            {(hunks) =>
              hunks.map((hunk) => (
                <Fragment key={hunk.content}>
                  <Decoration>
                    <span className="baud-git-hunk">{hunk.content}</span>
                  </Decoration>
                  <Hunk hunk={hunk} />
                </Fragment>
              ))
            }
          </Diff>
        </div>
      ) : null}

      {/* PARSE-FAIL SHOWS THE PATCH, NEVER A BLANK SCREEN. A binary file, a
          mode-only change and a shape the parser has not met all produce zero
          rendered files out of text that is perfectly readable - so the raw
          patch is what the operator gets, in a plain scrollable block. The
          renderer is a convenience over the server's answer; it is not allowed
          to become the only way to see it. */}
      {patch && !file ? (
        <pre className="baud-git-raw">{patch.diff || "the server sent an empty patch"}</pre>
      ) : null}

      {patch && file ? (
        <p className="baud-git-note">
          long lines fold at the edge — the whole patch scrolls with the page
        </p>
      ) : null}
    </section>
  );
}
