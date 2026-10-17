/** The roots roster, each row `/v1/roots` verbatim, never a hardcoded or fallback row (the fence refuses it).
 * Reference: docs/phone/files.md */

import { useEffect, useMemo, useState } from "react";

import { listRoots } from "../host";
import { HostError } from "../host/transport.http";
import type { RootEntry } from "../types";

/** The heading a kind prints; an unknown kind is drawn under its bare name, never dropped. */
const KIND_HEADINGS: Record<string, string> = {
  home: "home",
  aipass: "aipass",
  project: "projects",
  branch: "agents",
};

const KIND_ORDER = ["home", "project", "aipass", "branch"];

interface RootsScreenProps {
  /** A root was picked; `name` is the first path component, empty for kinds that name nothing. */
  onPick: (root: RootEntry) => void;
  onClose: () => void;
}

export default function RootsScreen({ onPick, onClose }: RootsScreenProps) {
  const [roots, setRoots] = useState<RootEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read on every mount, so a project added meanwhile shows next open.
  useEffect(() => {
    let mounted = true;
    listRoots()
      .then((got) => {
        if (mounted) setRoots(got);
      })
      .catch((cause) => {
        if (!mounted) return;
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
              {/* The name the fence is handed, when the label differs. */}
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

/** What a row prints: the server's label, else its name, else its kind (never empty). */
function labelOf(root: RootEntry): string {
  return root.label || root.name || root.kind;
}

/** The roster grouped by kind, known kinds first; order within a group is the server's, untouched. */
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
