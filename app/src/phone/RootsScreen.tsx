/**
 * THE ROOTS ROSTER - somewhere else to stand (FPLAN-0443).
 *
 * Patrick, 2026-08-18: "rn I can only see into agent files... I cant explore
 * home. or project files outside agents."
 *
 * THE BROWSER WAS NEVER THE MISSING PIECE. `FilesScreen` has been a real phone
 * file manager since DPLAN-0302 - one level at a time, an up chip, a Reader on
 * the other side of a tap - and it already opens at two different floors. What
 * it had no way to do was stand anywhere except inside a citizen's directory,
 * because the fence answered exactly one kind of word: a branch name. This
 * screen is the list of the other words, and everything behind it is the same
 * browse it always was.
 *
 * THE LIST IS THE SERVER'S, NOT THIS FACE'S. Every row comes from `/v1/roots`
 * and is echoed back verbatim - `kind` as the root selector, `name` as the
 * first component of the path. A roster spelled here would be a roster that
 * lies the day a project is added or renamed, and the fence would then refuse
 * a row this screen had drawn as real.
 *
 * SO IT REFUSES OUT LOUD RATHER THAN FALLING BACK. No hardcoded home row, no
 * "well, at least show the branches" - if the roster cannot be read, this
 * screen says so in @api's own words and offers nothing. A picker that invents
 * one plausible entry is how an operator learns to distrust the other twelve.
 *
 * GROUPED BY KIND, IN THE ROSTER'S OWN ORDER. The grouping is presentation and
 * nothing else: every row the server sent appears exactly once, in the order it
 * arrived, under a heading named after its kind. A kind this face has never met
 * gets its own heading and its rows, rather than being dropped for being
 * unfamiliar - the same rule the git chips follow.
 */

import { useEffect, useMemo, useState } from "react";

import { listRoots } from "../host";
import { HostError } from "../host/transport.http";
import type { RootEntry } from "../types";

/**
 * The heading a kind prints, and the ORDER the groups appear in.
 *
 * Kinds absent from this map are not refused - they are shown under their own
 * bare name, after the ones named here. The face knowing four words today must
 * not stop it drawing a fifth the server learns tomorrow.
 */
const KIND_HEADINGS: Record<string, string> = {
  home: "home",
  aipass: "aipass",
  project: "projects",
  branch: "agents",
};

/** The order the known kinds sit in. Home first: it is the one Patrick named. */
const KIND_ORDER = ["home", "project", "aipass", "branch"];

interface RootsScreenProps {
  /** A root was picked - browse it. `name` is the first path component, which
   *  is empty for the kinds that name nothing. */
  onPick: (root: RootEntry) => void;
  onClose: () => void;
}

export default function RootsScreen({ onPick, onClose }: RootsScreenProps) {
  const [roots, setRoots] = useState<RootEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // READ ON MOUNT, held across nothing - the git app's rule and for the same
  // reason: a project added while this face sat in a pocket is a project this
  // list must show the next time it opens.
  useEffect(() => {
    let mounted = true;
    listRoots()
      .then((got) => {
        if (mounted) setRoots(got);
      })
      .catch((cause) => {
        if (!mounted) return;
        // @api's sentence, verbatim - the fence names its own refusals.
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const groups = useMemo(() => group(roots ?? []), [roots]);

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ wheel
        </button>
        <span className="baud-phone-reader-title">files · where to look</span>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && roots === null ? <p className="baud-phone-empty">reading the roster…</p> : null}
      {/* AN EMPTY ROSTER IS AN ANSWER, not a blank screen. The server holds the
          list; if it holds none, saying so beats an empty box that reads as a
          face that failed to draw. */}
      {roots !== null && roots.length === 0 ? (
        <p className="baud-phone-empty">the server published no roots</p>
      ) : null}

      {groups.map(([kind, rows]) => (
        <div key={kind} className="baud-phone-roots-group">
          <h3 className="baud-phone-roots-head">{KIND_HEADINGS[kind] ?? kind}</h3>
          {rows.map((root) => (
            <button
              key={`${root.kind}/${root.name}`}
              type="button"
              className="baud-phone-file baud-phone-file-dir"
              onClick={() => onPick(root)}
            >
              <span className="baud-phone-file-name">{labelOf(root)}</span>
              {/* The name, when it is not already what the row prints - so a
                  project's row can say what the fence will actually be handed
                  rather than only what a person calls it. */}
              {root.name && root.name !== labelOf(root) ? (
                <span className="baud-phone-roots-name">{root.name}</span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * What a row prints: the server's label, else its name, else its kind.
 *
 * Three steps because each one can honestly be empty - a kind that names
 * nothing has no name, and a server that sends no label has not failed. The
 * last step cannot be empty, so a row always says something.
 */
function labelOf(root: RootEntry): string {
  return root.label || root.name || root.kind;
}

/**
 * The roster in groups, known kinds first in `KIND_ORDER` and everything else
 * after in first-seen order.
 *
 * PRESENTATION ONLY. Nothing is added, dropped or reordered WITHIN a group -
 * the server decided which projects exist and in what order, and this function
 * is not a second opinion about either.
 */
function group(roots: readonly RootEntry[]): Array<[string, RootEntry[]]> {
  const held = new Map<string, RootEntry[]>();
  for (const root of roots) {
    const rows = held.get(root.kind);
    if (rows) rows.push(root);
    else held.set(root.kind, [root]);
  }
  const known = KIND_ORDER.filter((kind) => held.has(kind));
  const rest = [...held.keys()].filter((kind) => !KIND_ORDER.includes(kind));
  return [...known, ...rest].map((kind) => [kind, held.get(kind) ?? []]);
}
