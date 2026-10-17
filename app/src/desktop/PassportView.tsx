import { useEffect, useMemo, useRef, useState } from "react";

import { readFileText } from "../host";
import type { BranchStatus } from "../types";

/**
 * The opened passport: one agent's `.trinity/` files read as a document, read-only.
 * Reference: docs/desktop/window-and-cards.md
 */

/** A monitor the passport can open, for manager-class agents only. */
export interface PassportMonitor {
  id: string;
  label: string;
  live: boolean;
  title: string;
  onToggle: () => void;
}

interface PassportViewProps {
  branch: BranchStatus;
  onClose: () => void;
  /** The global monitors, for manager-class passports only; the caller owns their tabs. */
  monitors: PassportMonitor[];
}

/** The working-memory tabs, in display order. */
const MEMORY_TABS = [
  { id: "sessions", label: "Sessions", file: "local", container: "sessions" },
  { id: "key_learnings", label: "Key Learnings", file: "local", container: "key_learnings" },
  { id: "todos", label: "Todos", file: "local", container: "todos" },
  { id: "observations", label: "Observations", file: "observations", container: "observations" },
] as const;

type MemoryTabId = (typeof MEMORY_TABS)[number]["id"];

/** The text of an entry, whichever of its names this container uses; none found is a stated absence. */
const TEXT_KEYS = ["summary", "learning", "note", "task", "text", "content"] as const;

interface Entry {
  /** `number` or `id`, whichever the container stamps. Absent is normal. */
  mark: string | null;
  date: string | null;
  text: string;
  /** Sessions carry a second paragraph worth showing - how it was proved. */
  verification: string | null;
  tags: string[];
}

function readEntry(raw: unknown): Entry {
  const row = (raw ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  const numberish = (key: string) =>
    typeof row[key] === "number" || typeof row[key] === "string" ? String(row[key]) : null;
  const found = TEXT_KEYS.map((key) => pick(key)).find((value) => value !== null);
  return {
    mark: numberish("number") ?? numberish("id"),
    date: pick("date") ?? pick("created"),
    text: found ?? "this entry carries no text under any name BAUD knows",
    verification: pick("verification"),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}

/** One `.trinity/` file, parsed - or the reason it could not be. */
interface Document {
  data: Record<string, unknown> | null;
  error: string | null;
}

const EMPTY: Document = { data: null, error: null };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function PassportView({ branch, onClose, monitors }: PassportViewProps) {
  const [passport, setPassport] = useState<Document>(EMPTY);
  const [local, setLocal] = useState<Document>(EMPTY);
  const [observations, setObservations] = useState<Document>(EMPTY);
  const [tab, setTab] = useState<MemoryTabId>("sessions");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const load = (relative: string, adopt: (next: Document) => void) => {
      readFileText(`${branch.path}/.trinity/${relative}`)
        .then((file) => {
          if (!alive.current) return;
          try {
            adopt({ data: JSON.parse(file.content) as Record<string, unknown>, error: null });
          } catch (err) {
            // A malformed memory file is the agent's news, not a BAUD fault.
            adopt({ data: null, error: `${relative} is not readable JSON: ${message(err)}` });
          }
        })
        .catch((err) => {
          if (alive.current) adopt({ data: null, error: message(err) });
        });
    };
    setPassport(EMPTY);
    setLocal(EMPTY);
    setObservations(EMPTY);
    load("passport.json", setPassport);
    load("local.json", setLocal);
    load("observations.json", setObservations);
  }, [branch.path]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const identity = (passport.data?.identity ?? {}) as Record<string, unknown>;
  const citizenship = (passport.data?.citizenship ?? {}) as Record<string, unknown>;
  const branchInfo = (passport.data?.branch_info ?? {}) as Record<string, unknown>;
  const principles = Array.isArray(passport.data?.principles)
    ? (passport.data?.principles as unknown[]).filter((line): line is string => typeof line === "string")
    : [];
  const line = (source: Record<string, unknown>, key: string): string | null =>
    typeof source[key] === "string" && source[key] !== "" ? (source[key] as string) : null;

  /** A field that is a string on most passports and a list on some (`traits`). */
  const lines = (source: Record<string, unknown>, key: string): string[] => {
    const held = source[key];
    if (typeof held === "string") return held === "" ? [] : [held];
    if (Array.isArray(held)) return held.filter((each): each is string => typeof each === "string" && each !== "");
    return [];
  };
  const traits = lines(identity, "traits");

  // The read is fenced to the seated project, so a roster card falls back to the snapshot.
  const citizenClass = line(identity, "citizen_class") ?? branch.citizen_class;

  const entries = useMemo(() => {
    const spec = MEMORY_TABS.find((each) => each.id === tab);
    if (!spec) return [];
    const source = spec.file === "local" ? local : observations;
    const rows = source.data?.[spec.container];
    if (!Array.isArray(rows)) return [];
    // Newest first by POSITION, not date: a hand-written date can be wrong, the order cannot.
    return rows.map(readEntry).reverse();
  }, [tab, local, observations]);

  const activeSpec = MEMORY_TABS.find((each) => each.id === tab);
  const activeSource = activeSpec?.file === "local" ? local : observations;

  return (
    <div className="baud-settings-scrim" onClick={onClose}>
      <section
        className="baud-passport"
        role="dialog"
        aria-modal="true"
        aria-label={`${branch.name} passport`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="baud-passport-title">
          <p className="baud-passport-issuer">AIPASS</p>
          <p className="baud-passport-type">AGENT PASSPORT</p>
          <h2 className="baud-passport-name">{branch.name}</h2>
          <button
            type="button"
            className="baud-passport-close"
            title="close the passport (or press escape)"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="baud-passport-body">
          <section className="baud-passport-page">
            <h3 className="baud-passport-page-head">Identity</h3>
            {passport.error ? (
              <p className="baud-passport-refusal" role="alert">
                {passport.error}
              </p>
            ) : null}
            <dl className="baud-passport-fields">
              <dt>Class</dt>
              <dd>{citizenClass || "no class declared"}</dd>
              <dt>Role</dt>
              <dd>{line(identity, "role") ?? "—"}</dd>
              <dt>Purpose</dt>
              <dd>{line(identity, "purpose") ?? "—"}</dd>
              <dt>Traits</dt>
              <dd>{traits.length > 0 ? traits.join(" · ") : "—"}</dd>
              <dt>Issued</dt>
              <dd>{line(branchInfo, "created") ?? "—"}</dd>
              {/* citizen_id is unique per agent; registry_id is shared by every sibling.
                  Printing registry_id as the passport number reads as duplicate passports. */}
              <dt>Passport no.</dt>
              <dd
                className="baud-passport-serial"
                title="the citizen's own unique id — no two agents share one"
              >
                {line(citizenship, "citizen_id") ?? "unissued"}
              </dd>
              <dt>Branch reg no.</dt>
              <dd
                className="baud-passport-serial"
                title="the registry's own id — shared by every citizen it holds"
              >
                {line(citizenship, "registry_id") ?? "unregistered"}
              </dd>
              <dt>Address</dt>
              <dd>{line(branchInfo, "email") ?? "—"}</dd>
              <dt>Project</dt>
              <dd>{branch.project}</dd>
              <dt>Sub-agents</dt>
              <dd>
                {branch.subagents > 0
                  ? `${branch.subagents} running inside this session`
                  : "none running"}
              </dd>
            </dl>
            {principles.length > 0 ? (
              <ul className="baud-passport-principles">
                {principles.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {monitors.length > 0 ? (
            <section className="baud-passport-page">
              <h3 className="baud-passport-page-head">Monitors</h3>
              <p className="baud-passport-hint">
                Read-only live views this manager owns. They open in the workbench, not here.
              </p>
              <div className="baud-passport-monitors">
                {monitors.map((monitor) => (
                  <button
                    key={monitor.id}
                    type="button"
                    className={`baud-monitor-toggle ${monitor.live ? "baud-monitor-toggle-live" : ""}`}
                    title={monitor.title}
                    onClick={monitor.onToggle}
                  >
                    <span className="baud-monitor-dot" aria-hidden="true" />
                    {monitor.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="baud-passport-page">
            <h3 className="baud-passport-page-head">Working memory</h3>
            <div className="baud-passport-tabs" role="tablist" aria-label="working memory">
              {MEMORY_TABS.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === spec.id}
                  className={`baud-passport-tab ${tab === spec.id ? "baud-passport-tab-on" : ""}`}
                  onClick={() => setTab(spec.id)}
                >
                  {spec.label}
                </button>
              ))}
            </div>

            {activeSource.error ? (
              <p className="baud-passport-refusal" role="alert">
                {activeSource.error}
              </p>
            ) : entries.length === 0 ? (
              <p className="baud-passport-hint">
                {activeSource.data === null
                  ? "reading…"
                  : `nothing recorded under ${activeSpec?.label.toLowerCase()} yet`}
              </p>
            ) : (
              <ol className="baud-passport-entries">
                {entries.map((entry, index) => (
                  <li key={`${entry.mark ?? "x"}-${index}`} className="baud-passport-entry">
                    <p className="baud-passport-entry-head">
                      {entry.mark ? <span className="baud-passport-entry-mark">#{entry.mark}</span> : null}
                      {entry.date ? <span className="baud-passport-entry-date">{entry.date}</span> : null}
                    </p>
                    <p className="baud-passport-entry-text">{entry.text}</p>
                    {entry.verification ? (
                      <p className="baud-passport-entry-proof">{entry.verification}</p>
                    ) : null}
                    {entry.tags.length > 0 ? (
                      <p className="baud-passport-entry-tags">
                        {entry.tags.map((tag) => (
                          <span key={tag} className="baud-passport-tag">
                            {tag}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            <p className="baud-passport-foot">
              The recent end only — older entries roll over into @memory's archive.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
