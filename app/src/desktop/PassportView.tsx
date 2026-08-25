import { useEffect, useMemo, useRef, useState } from "react";

import { readFileText } from "../host";
import type { BranchStatus } from "../types";

/**
 * The opened passport: one agent read as a document rather than a chip.
 *
 * A MODAL, NOT A WORKBENCH TAB - the call devpulse left me. Three reasons, in
 * order of weight. The workbench is where the operator WORKS: a terminal and
 * the files open beside it, all of them things you keep. A passport is
 * something you consult and dismiss, and parking it in the tab bar would put
 * a document that never changes next to a live session that does. Second, the
 * app already has exactly this shape for exactly this kind of thing - the
 * settings panels - so the operator learns no new gesture and escape already
 * means close. Third, the phone's AgentSheet is a sheet over the fleet for
 * the same reason; two faces, one idea.
 *
 * EVERY PAGE IS READ, NOTHING IS OWNED. The passport, the working memory and
 * the observations are @spawn's and the agent's own files. BAUD renders them
 * and cannot write one byte back - which is why a read that fails says so in
 * the file's own words instead of drawing an empty document that looks like
 * an agent with nothing to say.
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
  /**
   * The two global monitors, relocated off the top bar (m-round A). Passed
   * only for manager-class passports - the caller decides, because the caller
   * is what owns the tabs these toggles reflect.
   */
  monitors: PassportMonitor[];
}

/** The working-memory tabs, in the order Patrick named them. */
const MEMORY_TABS = [
  { id: "sessions", label: "Sessions", file: "local", container: "sessions" },
  { id: "key_learnings", label: "Key Learnings", file: "local", container: "key_learnings" },
  { id: "todos", label: "Todos", file: "local", container: "todos" },
  { id: "observations", label: "Observations", file: "observations", container: "observations" },
] as const;

type MemoryTabId = (typeof MEMORY_TABS)[number]["id"];

/**
 * The text of an entry, whichever of its names this container uses.
 *
 * The four containers were written by four different hands over months and
 * none of them agree: a session carries `summary`, a learning carries
 * `learning`, an observation carries `note`, a todo carries `task`. Rather
 * than four renderers, one lookup - and an entry whose text is under a name
 * nobody has used yet renders as a stated absence, never as a blank card.
 */
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

  // Mounting IS opening, exactly as the settings panels do it: every open
  // re-reads, so a passport can never show a picture of a file the agent
  // rewrote while the card sat on screen.
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

  /**
   * A field that is a STRING on most passports and a LIST on some - measured,
   * not assumed: @devpulse and @aipass carry `traits` as arrays. A string-only
   * reader printed their populated Traits as an em-dash here, which is the
   * phone sheet's exact warning come true on this face.
   */
  const lines = (source: Record<string, unknown>, key: string): string[] => {
    const held = source[key];
    if (typeof held === "string") return held === "" ? [] : [held];
    if (Array.isArray(held)) return held.filter((each): each is string => typeof each === "string" && each !== "");
    return [];
  };
  const traits = lines(identity, "traits");

  // The class the FILE claims, falling back to the snapshot's copy of the same
  // field - the passport read is fenced to the seated project, so a roster
  // card gets no document and the strip's value is all there is.
  const citizenClass = line(identity, "citizen_class") ?? branch.citizen_class;

  const entries = useMemo(() => {
    const spec = MEMORY_TABS.find((each) => each.id === tab);
    if (!spec) return [];
    const source = spec.file === "local" ? local : observations;
    const rows = source.data?.[spec.container];
    if (!Array.isArray(rows)) return [];
    // Newest first, and by POSITION not by date: these files are appended to,
    // and a hand-written date can be wrong in a way the order never is.
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
        {/* THE TITLE BLOCK, real-passport order and Patrick's design: who
            issued it, what the document is, then whose it is. */}
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
            {/* A passport is a document of FIELDS, so it is rendered as
                fields - never as the raw JSON it happens to be stored in. */}
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
              {/* TWO NUMBERS, TWO MEANINGS (Patrick's ruling, 2026-08-24):
                  citizen_id is the citizen's own unique id - the passport
                  number, no two agents share one. registry_id is the id of
                  the REGISTRY holding the citizen, shared by every sibling BY
                  DESIGN - the lock to the branch registry. This row used to
                  print the shared lock as "Passport no.", which is how a
                  fleet-wide audit briefly read as 18 duplicate passports. */}
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
              {/* A count, and only ever a count: sub-agents are not citizens,
                  they have no names in this lane and BAUD will not imply any. */}
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

          {/* MANAGER PASSPORTS ONLY. These two lived in the top bar, which had
              no room for them; they belong to the agent that runs them, and a
              manager's passport is where an operator goes looking for what a
              manager runs. The doors are the same openMonitor/closeFile the
              header used - relocated, not reimplemented. */}
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
            {/* The files roll over into @memory's vectors, so what is on
                screen is the RECENT end and saying so costs one line. */}
            <p className="baud-passport-foot">
              The recent end only — older entries roll over into @memory's archive.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
