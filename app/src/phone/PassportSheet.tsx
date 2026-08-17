/**
 * The opened passport, phone-shaped - the transfer round's document.
 *
 * The desktop's `PassportView` is the SPEC and it is frozen: this file copies
 * its CONTENT and ORDER (Patrick's real-passport layout - who issued it, what
 * it is, whose it is, then the pages) and none of its pixel layout. Three
 * phone-shaped calls, all mine, all reversible:
 *
 *   1. FIELDS STACK, label above value. The desk renders a two-column `dl`,
 *      which at 46 columns would leave a Purpose sentence about thirty
 *      characters to live in. Stacking costs height on a surface that already
 *      scrolls and gains the whole width for the value - and it happens to be
 *      how a real passport prints a field, which is the layout Patrick asked
 *      for in the first place.
 *   2. ENTRIES CLAMP AND OPEN ON TAP. A session summary in this fleet runs to
 *      well over a thousand characters; four of them unclamped is a wall, and
 *      a wall is not a document. Six lines with a tap to open keeps the tab
 *      scannable, and the tap target is the whole entry.
 *   3. NO KEYBOARD ESCAPE. The desk closes on escape because it has a keyboard;
 *      this closes on the backdrop and on an explicit ✕, the two gestures every
 *      other sheet on this face already uses.
 *
 * EVERY PAGE IS READ, NOTHING IS OWNED - the desktop's rule, carried whole. The
 * three files belong to @spawn and to the agent; BAUD renders them and writes
 * nothing back, so a read that fails says so in the HOST's own words rather
 * than drawing an empty document, which would read as an agent with nothing to
 * say. That distinction is load-bearing on this face in a way it never was at
 * the desk, because this face's read lane really does refuse some branches.
 *
 * NAMES, NEVER PATHS. The desk asks for `${branch.path}/.trinity/passport.json`
 * - an absolute path, which this face's transport refuses by design. The host
 * fence takes a branch NAME and a relative file, so that is what is passed:
 * `${branch.name}/.trinity/passport.json`, the same shape the sheet's TODOS
 * tile has been reading since the stats row went live.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { readFileText } from "../host";
import type { BranchStatus } from "../types";

/** The three documents, by the names the fence takes. */
const TRINITY = ".trinity";

/** The working-memory tabs, in the order Patrick named them. Desktop parity. */
const MEMORY_TABS = [
  { id: "sessions", label: "Sessions", file: "local", container: "sessions" },
  { id: "key_learnings", label: "Learnings", file: "local", container: "key_learnings" },
  { id: "todos", label: "Todos", file: "local", container: "todos" },
  { id: "observations", label: "Observations", file: "observations", container: "observations" },
] as const;

type MemoryTabId = (typeof MEMORY_TABS)[number]["id"];

/**
 * The text of an entry, whichever of its names this container uses.
 *
 * Ported verbatim from the desk, and for the desk's reason: the four containers
 * were written by four different hands and none of them agree - a session
 * carries `summary`, a learning `learning`, an observation `note`, a todo
 * `task`. One lookup beats four renderers, and an entry whose text hides under
 * a name nobody has used yet renders as a stated absence, never a blank card.
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

/** A monitor this passport can open - manager-class agents only. */
export interface SheetMonitor {
  id: string;
  label: string;
  hint: string;
  /** Absent = this face has no route for it, and the hint says which. */
  open: (() => void) | null;
}

interface PassportSheetProps {
  branch: BranchStatus;
  /**
   * The monitors a MANAGER runs, relocated into the passport exactly as the
   * desk did it. Empty for everyone else - the caller decides, because the
   * caller owns the panes these doors open.
   */
  monitors: SheetMonitor[];
  onClose: () => void;
}

export default function PassportSheet({ branch, monitors, onClose }: PassportSheetProps) {
  const [passport, setPassport] = useState<Document>(EMPTY);
  const [local, setLocal] = useState<Document>(EMPTY);
  const [observations, setObservations] = useState<Document>(EMPTY);
  const [tab, setTab] = useState<MemoryTabId>("sessions");
  /** Which entries the operator has opened out of the clamp, by position. */
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Mounting IS opening, as at the desk: every open re-reads, so a passport can
  // never show a picture of a file the agent rewrote while the sheet sat up.
  // Keyed on the NAME, not the object - the poll hands down a fresh card every
  // tick and re-reading three files ten times a minute is a leak, not a policy.
  useEffect(() => {
    const load = (file: string, adopt: (next: Document) => void) => {
      // The project is NAMED, never inferred. Browsing is free across projects
      // now, and an unnamed project resolves under the seat - which for a
      // foreign card does not fail, it quietly reads a same-named local agent's
      // memory and prints it under this agent's name.
      readFileText(`${branch.name}/${TRINITY}/${file}`, branch.project)
        .then((read) => {
          if (!alive.current) return;
          try {
            adopt({ data: JSON.parse(read.content) as Record<string, unknown>, error: null });
          } catch (err) {
            // A malformed memory file is the agent's news, not a BAUD fault.
            adopt({ data: null, error: `${file} is not readable JSON: ${message(err)}` });
          }
        })
        .catch((err) => {
          if (alive.current) adopt({ data: null, error: message(err) });
        });
    };
    setPassport(EMPTY);
    setLocal(EMPTY);
    setObservations(EMPTY);
    setOpened({});
    load("passport.json", setPassport);
    load("local.json", setLocal);
    load("observations.json", setObservations);
    // Both halves of the address, because either one changing means a different
    // agent's documents - two projects can carry the same branch name.
  }, [branch.name, branch.project]);

  const identity = (passport.data?.identity ?? {}) as Record<string, unknown>;
  const citizenship = (passport.data?.citizenship ?? {}) as Record<string, unknown>;
  const branchInfo = (passport.data?.branch_info ?? {}) as Record<string, unknown>;
  const principles = Array.isArray(passport.data?.principles)
    ? (passport.data?.principles as unknown[]).filter((line): line is string => typeof line === "string")
    : [];
  const line = (source: Record<string, unknown>, key: string): string | null =>
    typeof source[key] === "string" && source[key] !== "" ? (source[key] as string) : null;

  /**
   * A field that is a STRING on most passports and a LIST on some.
   *
   * Measured, not assumed: @devpulse's `traits` is a JSON array of six
   * sentences while every other branch I read carries a plain string. A
   * string-only reader renders that agent's Traits as an em-dash - a document
   * printing "nothing here" over a populated field, which is precisely the lie
   * this passport is not allowed to tell. So both shapes are read, and anything
   * that is neither still falls through to a stated absence.
   */
  const lines = (source: Record<string, unknown>, key: string): string[] => {
    const held = source[key];
    if (typeof held === "string") return held === "" ? [] : [held];
    if (Array.isArray(held)) return held.filter((each): each is string => typeof each === "string" && each !== "");
    return [];
  };

  const traits = lines(identity, "traits");

  // The class the FILE claims, falling back to the snapshot's copy of the same
  // field - when the read is refused the card's value is all there is, and it
  // is the same field read by a different lane, not a guess.
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

  // ORDER IS THE DESK'S, field for field - it is Patrick's real-passport
  // layout and the one thing this port is not allowed to improve on. Traits
  // keeps its place between Purpose and Issued whichever shape it arrives in.
  const fields: ReadonlyArray<{ label: string; value: string; serial?: boolean; list?: string[] }> = [
    { label: "Class", value: citizenClass || "no class declared" },
    { label: "Role", value: line(identity, "role") ?? "—" },
    { label: "Purpose", value: line(identity, "purpose") ?? "—" },
    {
      label: "Traits",
      value: traits.length === 0 ? "—" : traits.length === 1 ? traits[0] : "",
      list: traits.length > 1 ? traits : undefined,
    },
    { label: "Issued", value: line(branchInfo, "created") ?? "—" },
    { label: "Passport no.", value: line(citizenship, "registry_id") ?? "unregistered", serial: true },
    { label: "Address", value: line(branchInfo, "email") ?? "—" },
    { label: "Project", value: branch.project },
    {
      // A count, and only ever a count: sub-agents are not citizens, they have
      // no names in this lane and BAUD will not imply any.
      label: "Sub-agents",
      value: branch.subagents > 0 ? `${branch.subagents} running inside this session` : "none running",
    },
  ];

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop dismissal; every control inside is a real button.
    <div
      className="baud-pass-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="baud-pass" aria-label={`${branch.name} passport`}>
        {/* THE TITLE BLOCK, real-passport order: who issued it, what the
            document is, then whose it is. */}
        <header className="baud-pass-title">
          <p className="baud-pass-issuer">AIPASS</p>
          <p className="baud-pass-type">AGENT PASSPORT</p>
          <h2 className="baud-pass-name">{branch.name.toUpperCase()}</h2>
          <button type="button" className="baud-pass-close" title="close the passport" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="baud-pass-body">
          <section className="baud-pass-page">
            <h3 className="baud-pass-head">Identity</h3>
            {/* The host's sentence, not ours. This face's read lane really does
                refuse some branches, so this line is a working part of the
                document rather than a defensive branch nobody sees. */}
            {passport.error ? (
              <p className="baud-pass-refusal" role="alert">
                {passport.error}
              </p>
            ) : null}
            <dl className="baud-pass-fields">
              {fields.map((field) => (
                <div key={field.label} className="baud-pass-field">
                  <dt>{field.label}</dt>
                  {field.list ? (
                    <dd>
                      <ul className="baud-pass-field-list">
                        {field.list.map((each) => (
                          <li key={each}>{each}</li>
                        ))}
                      </ul>
                    </dd>
                  ) : (
                    <dd className={field.serial ? "baud-pass-serial" : undefined}>{field.value}</dd>
                  )}
                </div>
              ))}
            </dl>
            {principles.length > 0 ? (
              <ul className="baud-pass-principles">
                {principles.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* MANAGER PASSPORTS ONLY, the desk's relocation carried over: these
              belong to the agent that runs them, and a manager's passport is
              where an operator goes looking for what a manager runs. */}
          {monitors.length > 0 ? (
            <section className="baud-pass-page">
              <h3 className="baud-pass-head">Monitors</h3>
              <p className="baud-pass-hint">
                Read-only live views this manager owns. They open as panes below, not here.
              </p>
              <div className="baud-pass-monitors">
                {monitors.map((monitor) => (
                  <button
                    key={monitor.id}
                    type="button"
                    className="baud-pass-monitor"
                    // A door with no route is SHOWN and refused with the reason,
                    // never hidden - the same ruling the scope-refused verbs
                    // ride. Hiding it would make an absent lane look like a
                    // feature the phone was never meant to have.
                    disabled={!monitor.open}
                    title={monitor.hint}
                    onClick={() => monitor.open?.()}
                  >
                    {monitor.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="baud-pass-page">
            <h3 className="baud-pass-head">Working memory</h3>
            <div className="baud-pass-tabs" role="tablist" aria-label="working memory">
              {MEMORY_TABS.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === spec.id}
                  className={`baud-pass-tab ${tab === spec.id ? "baud-pass-tab-on" : ""}`}
                  onClick={() => {
                    setTab(spec.id);
                    // A clamp opened on one tab means nothing on the next: the
                    // keys are positions, and position 3 is a different entry.
                    setOpened({});
                  }}
                >
                  {spec.label}
                </button>
              ))}
            </div>

            {activeSource.error ? (
              <p className="baud-pass-refusal" role="alert">
                {activeSource.error}
              </p>
            ) : entries.length === 0 ? (
              <p className="baud-pass-hint">
                {activeSource.data === null
                  ? "reading…"
                  : `nothing recorded under ${activeSpec?.label.toLowerCase()} yet`}
              </p>
            ) : (
              <ol className="baud-pass-entries">
                {entries.map((entry, index) => (
                  <li key={`${entry.mark ?? "x"}-${index}`}>
                    <button
                      type="button"
                      className="baud-pass-entry"
                      title={opened[index] ? "tap to fold this entry" : "tap to read the whole entry"}
                      onClick={() => setOpened((was) => ({ ...was, [index]: !was[index] }))}
                    >
                      <span className="baud-pass-entry-head">
                        {entry.mark ? <b>#{entry.mark}</b> : null}
                        {entry.date ? <span>{entry.date}</span> : null}
                      </span>
                      <span className={`baud-pass-entry-text ${opened[index] ? "" : "baud-pass-clamp"}`}>
                        {entry.text}
                      </span>
                      {entry.verification && opened[index] ? (
                        <span className="baud-pass-entry-proof">{entry.verification}</span>
                      ) : null}
                      {entry.tags.length > 0 ? (
                        <span className="baud-pass-entry-tags">{entry.tags.join(" · ")}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {/* The files roll over into @memory's vectors, so what is on screen
                is the RECENT end and saying so costs one line. */}
            <p className="baud-pass-foot">
              The recent end only — older entries roll over into @memory's archive.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
