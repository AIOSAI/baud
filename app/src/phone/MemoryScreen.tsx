/**
 * WORKING MEMORY - the agent's own workbook, on its own screen (compass #291).
 *
 * NOTHING HERE IS NEW WORK, and that is the point of the round. These four tabs
 * were pages of the passport: the same two `.trinity` files, read by the same
 * named-file lane, extracted by the same reader that has to cope with four
 * containers written by four different hands. What changed is WHERE they hang.
 * A passport says who an agent IS and only @spawn can change it; a memory file
 * is what the agent DID this morning. Filing the second inside the first made
 * the document lie about its own nature - so the workbook came out and became a
 * door on the card, beside every other live thing.
 *
 * IT IS A SCREEN, NOT A SHEET, which is the FilesScreen idiom rather than the
 * passport's: the reader shell (full height, one `‹ back`, sticky head) with
 * its own list classes inside. Four tabs of thousand-character summaries is a
 * reading surface, and a reading surface on this face is a screen.
 *
 * NAMES, NEVER PATHS, and the PROJECT IS NAMED. `${branch}/.trinity/local.json`
 * is what the host fence takes; an unnamed project resolves under the seat,
 * which for a foreign card does not fail - it quietly reads a same-named local
 * agent's memory and prints it under this agent's name.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { readFileText } from "../host";

/** The two documents behind these tabs, by the names the fence takes. */
const TRINITY = ".trinity";

/** The tabs, in the order Patrick named them. Desktop parity. */
const MEMORY_TABS = [
  { id: "sessions", label: "sessions", file: "local", container: "sessions" },
  { id: "key_learnings", label: "key learnings", file: "local", container: "key_learnings" },
  { id: "todos", label: "todos", file: "local", container: "todos" },
  { id: "observations", label: "observations", file: "observations", container: "observations" },
] as const;

export type MemoryTabId = (typeof MEMORY_TABS)[number]["id"];

/**
 * The text of an entry, whichever of its names this container uses.
 *
 * Carried over whole, and for its original reason: the four containers were
 * written by four different hands and none of them agree - a session carries
 * `summary`, a learning `value` under a `key`, an observation `note`, a todo
 * `task`. One lookup beats four renderers, and an entry whose text hides under
 * a name nobody has used yet renders as a stated absence, never a blank card.
 *
 * `value` JOINED THE LIST IN THIS ROUND and it is a fix, not a preference:
 * every `key_learnings` array in the fleet (17 of 17, measured) is
 * `{number, date, key, value}`, and with `value` missing from these names the
 * whole learnings tab rendered the "no text under any name" line on real data.
 * The mock's memory screen prints the key as its own line above the body, which
 * is exactly the shape that data has, so both halves are read.
 */
const TEXT_KEYS = ["summary", "learning", "note", "task", "value", "text", "content"] as const;

interface Entry {
  /** `number` or `id`, whichever the container stamps. Absent is normal. */
  mark: string | null;
  date: string | null;
  /** A learning's headline. Absent on every other container, which is fine. */
  key: string | null;
  text: string;
  /** Sessions carry a second paragraph worth showing - how it was proved. */
  verification: string | null;
  tags: string[];
}

function readEntry(raw: unknown): Entry {
  const row = (raw ?? {}) as Record<string, unknown>;
  const pick = (name: string) => (typeof row[name] === "string" ? (row[name] as string) : null);
  const numberish = (name: string) =>
    typeof row[name] === "number" || typeof row[name] === "string" ? String(row[name]) : null;
  const found = TEXT_KEYS.map((name) => pick(name)).find((value) => value !== null);
  return {
    mark: numberish("number") ?? numberish("id"),
    date: pick("date") ?? pick("created"),
    key: pick("key"),
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

interface MemoryScreenProps {
  /** The branch whose workbook this is. */
  branch: string;
  /** Which project that branch lives in - browsing is free across projects.
   *  Empty means the seat, the pre-ruling meaning. */
  project: string;
  /**
   * The tab in front when the screen opens (DPLAN-0414 A#2). The card's TODOS
   * tile asks for `todos`: it used to open the raw `.trinity` file, and the
   * owner's ruling is that the designed read wins wherever one exists. Absent
   * is the first tab, which is what the memory door has always opened on.
   */
  initialTab?: MemoryTabId;
  /** The word after `‹`: where back lands - `card`, from the trail
   *  (DPLAN-0414 wave 6). Absent is `back`. */
  backLabel?: string;
  onClose: () => void;
}

export default function MemoryScreen({
  branch,
  project,
  initialTab = MEMORY_TABS[0].id,
  backLabel = "back",
  onClose,
}: MemoryScreenProps) {
  const [local, setLocal] = useState<Document>(EMPTY);
  const [observations, setObservations] = useState<Document>(EMPTY);
  const [tab, setTab] = useState<MemoryTabId>(initialTab);
  /** Which entries the operator has opened out of the clamp, by position. */
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Mounting IS opening: every open re-reads, so this screen can never show a
  // picture of a file the agent rewrote while it sat up.
  useEffect(() => {
    const load = (file: string, adopt: (next: Document) => void) => {
      readFileText(`${branch}/${TRINITY}/${file}`, project)
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
          // @api's own sentence, verbatim - a fence that refuses says why.
          if (alive.current) adopt({ data: null, error: message(err) });
        });
    };
    setLocal(EMPTY);
    setObservations(EMPTY);
    setOpened({});
    load("local.json", setLocal);
    load("observations.json", setObservations);
    // Both halves of the address, because either one changing means a different
    // agent's memory - two projects can carry the same branch name.
  }, [branch, project]);

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
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ {backLabel}
        </button>
        <span className="baud-phone-reader-title">{branch} · working memory</span>
      </header>

      <div className="baud-mem-body">
        <div className="baud-mem-tabs" role="tablist" aria-label="working memory">
          {MEMORY_TABS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              role="tab"
              aria-selected={tab === spec.id}
              className={`baud-mem-tab ${tab === spec.id ? "baud-mem-tab-on" : ""}`}
              onClick={() => {
                setTab(spec.id);
                // A clamp opened on one tab means nothing on the next: the keys
                // are positions, and position 3 is a different entry.
                setOpened({});
              }}
            >
              {spec.label}
            </button>
          ))}
        </div>

        {activeSource.error ? (
          <p className="baud-phone-error" role="alert">
            {activeSource.error}
          </p>
        ) : entries.length === 0 ? (
          <p className="baud-phone-empty">
            {activeSource.data === null ? "reading…" : `nothing recorded under ${activeSpec?.label} yet`}
          </p>
        ) : (
          <ol className="baud-mem-entries">
            {entries.map((entry, index) => (
              <li key={`${entry.mark ?? "x"}-${index}`}>
                {/* THE WHOLE CARD IS THE TAP TARGET. A session summary in this
                    fleet runs to well over a thousand characters; four of them
                    unclamped is a wall, and a wall is not something a thumb
                    reads. Six lines with a tap to open keeps the tab scannable
                    and a "more" link would be a 20px word inside a paragraph. */}
                <button
                  type="button"
                  className="baud-mem-entry"
                  title={opened[index] ? "tap to fold this entry" : "tap to read the whole entry"}
                  onClick={() => setOpened((was) => ({ ...was, [index]: !was[index] }))}
                >
                  <span className="baud-mem-entry-head">
                    {entry.mark ? <b>#{entry.mark}</b> : null}
                    {entry.date ? <span>{entry.date}</span> : null}
                  </span>
                  {entry.key ? <span className="baud-mem-entry-key">{entry.key}</span> : null}
                  <span className={`baud-mem-entry-text ${opened[index] ? "" : "baud-mem-clamp"}`}>
                    {entry.text}
                  </span>
                  {entry.verification && opened[index] ? (
                    <span className="baud-mem-entry-proof">{entry.verification}</span>
                  ) : null}
                  {entry.tags.length > 0 ? (
                    <span className="baud-mem-entry-tags">{entry.tags.join(" · ")}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        )}

        {/* The files roll over into @memory's vectors, so what is on screen is
            the RECENT end and saying so costs one line. */}
        <p className="baud-mem-foot">
          The recent end only — older entries roll over into @memory's archive.
        </p>

        {/* WHICH LIMITS DECIDED WHAT IS ON THIS SCREEN, and where they are set.
            It is TEXT, not a door: it names two addresses in words. The fleet
            defaults live under settings → memory; this agent's OWN limits are
            the card's gear, which writes them through `/v1/memory-config/set`
            (desktop/AgentSettings.tsx). The line used to say per-agent
            overrides were still to come, while that gear already wrote them
            (DPLAN-0414 A#10). */}
        <p className="baud-mem-foot">
          limits: fleet defaults — settings → memory · per-agent limits: this card's gear
        </p>
      </div>
    </section>
  );
}
