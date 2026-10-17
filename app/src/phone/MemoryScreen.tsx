/**
 * Working memory: the agent's `.trinity` tabs on their own screen.
 * Reference: docs/phone/card.md
 *
 * The project is always named: unnamed, a foreign card would read a same-named local agent's memory.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { readFileText } from "../host";

const TRINITY = ".trinity";

/** Desktop parity: same tabs, same order. */
const MEMORY_TABS = [
  { id: "sessions", label: "sessions", file: "local", container: "sessions" },
  { id: "key_learnings", label: "key learnings", file: "local", container: "key_learnings" },
  { id: "todos", label: "todos", file: "local", container: "todos" },
  { id: "observations", label: "observations", file: "observations", container: "observations" },
] as const;

export type MemoryTabId = (typeof MEMORY_TABS)[number]["id"];

/**
 * An entry's text under whichever name its container uses; each container was written by a different hand.
 * `value` is the learnings' body (`{number, date, key, value}`); without it that tab reads as empty.
 */
const TEXT_KEYS = ["summary", "learning", "note", "task", "value", "text", "content"] as const;

interface Entry {
  mark: string | null;
  date: string | null;
  key: string | null;
  text: string;
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

interface Document {
  data: Record<string, unknown> | null;
  error: string | null;
}

const EMPTY: Document = { data: null, error: null };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface MemoryScreenProps {
  branch: string;
  /** Empty means the seat. */
  project: string;
  /** The tab in front on open; the card's TODOS tile asks for `todos`. */
  initialTab?: MemoryTabId;
  /** The word after `‹`. Absent is `back`. */
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
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Every open re-reads, so the screen never shows a file the agent rewrote meanwhile.
  useEffect(() => {
    const load = (file: string, adopt: (next: Document) => void) => {
      readFileText(`${branch}/${TRINITY}/${file}`, project)
        .then((read) => {
          if (!alive.current) return;
          try {
            adopt({ data: JSON.parse(read.content) as Record<string, unknown>, error: null });
          } catch (err) {
            adopt({ data: null, error: `${file} is not readable JSON: ${message(err)}` });
          }
        })
        .catch((err) => {
          if (alive.current) adopt({ data: null, error: message(err) });
        });
    };
    setLocal(EMPTY);
    setObservations(EMPTY);
    setOpened({});
    load("local.json", setLocal);
    load("observations.json", setObservations);
    // Both halves: two projects can carry the same branch name.
  }, [branch, project]);

  const entries = useMemo(() => {
    const spec = MEMORY_TABS.find((each) => each.id === tab);
    if (!spec) return [];
    const source = spec.file === "local" ? local : observations;
    const rows = source.data?.[spec.container];
    if (!Array.isArray(rows)) return [];
    // Newest first by position, not date: the files are appended to, and a hand-written date can be wrong.
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
                // The opened keys are positions; position 3 on another tab is a different entry.
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

        <p className="baud-mem-foot">
          The recent end only — older entries roll over into @memory's archive.
        </p>

        <p className="baud-mem-foot">
          limits: fleet defaults — settings → memory · per-agent limits: this card's gear
        </p>
      </div>
    </section>
  );
}
