import { useEffect, useRef, useState } from "react";
import { memoryConfigRead, memoryConfigWrite } from "../host";

import type { MemoryConfig, MemoryConfigPatch } from "../types";

/**
 * The memory dials (m13), a section inside BAUD's interface panel.
 *
 * These numbers are @memory's, not BAUD's: one shared config file that every
 * citizen in the ecosystem lives under. Two consequences shape this component.
 *
 * It saves SEPARATELY from the rest of the panel. The interface gear writes
 * BAUD's own `.aipass/baud.settings.json`; this writes another agent's file
 * through another command, and one button doing both would make a poll-cadence
 * tweak silently rewrite the fleet's memory limits.
 *
 * And the two halves apply differently, which the UI has to say out loud
 * rather than imply: character caps are re-read live by the enforcement hook,
 * so they bind on the next memory write, while keep-counts are defaults that
 * only reach the branches when the operator runs `drone @memory rollover push`.
 * BAUD prints that command and stops there - pushing config to seventeen
 * branches is @memory's job, not a side effect of closing a dialog.
 *
 * Per-branch overrides are shown, never edited: they are written BY that push,
 * and seventeen editable copies of the same three dials is a panel nobody can
 * read.
 */

/** Tauri rejects with the backend's error string, not an Error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A rollover dial's identity is its group AND its key. */
function dialId(group: string, key: string): string {
  return `${group}/${key}`;
}

/** What a cap actually limits, in the operator's words rather than the file's. */
function capHint(file: string, container: string, field: string): string {
  return `${container}[].${field} in ${file}`;
}

type Numbers = Record<string, number>;

export default function MemorySettings() {
  const [config, setConfig] = useState<MemoryConfig | null>(null);
  const [caps, setCaps] = useState<Numbers>({});
  const [counts, setCounts] = useState<Numbers>({});
  const [autoCaps, setAutoCaps] = useState<Numbers>({});
  const [openBranches, setOpenBranches] = useState(false);

  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    memoryConfigRead()
      .then((next) => {
        if (!alive.current) return;
        adopt(next);
        setReadError(null);
      })
      .catch((err) => {
        if (alive.current) setReadError(message(err));
      });
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  /** Disk truth in, editor state out - the only place these numbers are set. */
  function adopt(next: MemoryConfig) {
    setConfig(next);
    setCaps(Object.fromEntries(next.entry_limits.map((l) => [l.key, l.max_chars])));
    setCounts(Object.fromEntries(next.rollover.map((d) => [dialId(d.group, d.key), d.count])));
    setAutoCaps(
      Object.fromEntries(
        next.rollover
          .filter((d) => d.auto_compact_cap !== null)
          .map((d) => [dialId(d.group, d.key), d.auto_compact_cap as number]),
      ),
    );
  }

  // Only genuine differences reach the wire, and a field the operator cleared
  // (NaN, not a number) is treated as untouched rather than written as zero -
  // the backend would refuse it anyway, and refusing the whole save because
  // one box is mid-edit would be a hostile way to say so.
  const patch: MemoryConfigPatch = { caps: [], rollover: [] };
  if (config) {
    for (const limit of config.entry_limits) {
      const next = caps[limit.key];
      if (Number.isFinite(next) && next !== limit.max_chars) {
        patch.caps.push({ key: limit.key, max_chars: next });
      }
    }
    for (const dial of config.rollover) {
      const id = dialId(dial.group, dial.key);
      const count = counts[id];
      const auto = autoCaps[id];
      const countMoved = Number.isFinite(count) && count !== dial.count;
      const autoMoved =
        dial.auto_compact_cap !== null && Number.isFinite(auto) && auto !== dial.auto_compact_cap;
      if (countMoved || autoMoved) {
        patch.rollover.push({
          group: dial.group,
          key: dial.key,
          ...(countMoved ? { count } : {}),
          ...(autoMoved ? { auto_compact_cap: auto } : {}),
        });
      }
    }
  }
  const pending = patch.caps.length + patch.rollover.length;

  const save = () => {
    if (pending === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    memoryConfigWrite(patch)
      .then((next) => {
        // What comes back is the file re-read, so the panel always settles on
        // what @memory's config actually says - never on what BAUD sent.
        if (!alive.current) return;
        adopt(next);
        setSaved(true);
      })
      .catch((err) => {
        if (alive.current) setWriteError(message(err));
      })
      .finally(() => {
        if (alive.current) setSaving(false);
      });
  };

  const number = (value: number | undefined, onChange: (next: number) => void, min: number) => (
    <input
      type="number"
      className="baud-settings-number"
      min={min}
      step={1}
      value={Number.isFinite(value) ? value : ""}
      onChange={(event) => onChange(event.target.valueAsNumber)}
    />
  );

  return (
    <section className="baud-memory" aria-label="memory dials">
      <header className="baud-memory-head">
        <span className="baud-memory-title">memory · @memory's config</span>
        {config ? (
          <span className="baud-memory-path" title={config.path}>
            {config.path}
          </span>
        ) : null}
      </header>

      {readError ? (
        <p className="baud-settings-error" role="alert">
          memory config: {readError}
        </p>
      ) : null}

      {config ? (
        <>
          <p className="baud-memory-note">
            entry caps · read live by the enforcement hook, so a save binds on the next
            memory write
            {config.enforced ? null : (
              <strong className="baud-memory-warn"> · enforcement is OFF in this file</strong>
            )}
          </p>

          {config.entry_limits.map((limit) => (
            <label className="baud-settings-row" key={limit.key}>
              <span className="baud-settings-label">{limit.key.replace(/_/g, " ")}</span>
              {number(caps[limit.key], (next) => setCaps({ ...caps, [limit.key]: next }), 1)}
              <span className="baud-settings-hint">
                chars · {capHint(limit.file, limit.container, limit.field)}
              </span>
            </label>
          ))}

          <p className="baud-memory-note">
            rollover keep-counts · defaults only. They reach the branches when you run
            <code className="baud-memory-cmd">drone @memory rollover push</code>
          </p>

          {config.rollover.map((dial) => {
            const id = dialId(dial.group, dial.key);
            return (
              <label className="baud-settings-row" key={id}>
                <span className="baud-settings-label">{dial.key.replace(/_/g, " ")}</span>
                {number(counts[id], (next) => setCounts({ ...counts, [id]: next }), 1)}
                <span className="baud-settings-hint">kept in {dial.group}</span>
                {dial.auto_compact_cap !== null ? (
                  <>
                    {number(autoCaps[id], (next) => setAutoCaps({ ...autoCaps, [id]: next }), 0)}
                    <span className="baud-settings-hint">auto-compact cap</span>
                  </>
                ) : null}
              </label>
            );
          })}

          {config.per_branch.length > 0 ? (
            <div className="baud-memory-branches">
              <button
                type="button"
                className="baud-memory-toggle"
                onClick={() => setOpenBranches((open) => !open)}
                title="branches whose limits differ from the defaults - written by the push, read-only here"
              >
                {openBranches ? "▾" : "▸"} {config.per_branch.length} branch override(s)
              </button>
              {openBranches ? (
                <ul className="baud-memory-list">
                  {config.per_branch.map((branch) => (
                    <li key={branch.branch}>
                      <span className="baud-memory-branch">@{branch.branch}</span>
                      {branch.dials.map((dial) => (
                        <span className="baud-memory-dial" key={dialId(dial.group, dial.key)}>
                          {dial.key} {dial.count}
                          {dial.auto_compact_cap !== null ? `/${dial.auto_compact_cap}` : ""}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {writeError ? (
            <p className="baud-settings-error" role="alert">
              write failed: {writeError}
            </p>
          ) : null}

          <footer className="baud-settings-foot">
            <span
              className={`baud-settings-note ${saved && pending === 0 ? "baud-settings-note-saved" : ""}`}
            >
              {pending > 0 ? `${pending} dial(s) pending` : saved ? "saved" : "no changes"}
            </span>
            <button
              type="button"
              className="baud-settings-save"
              disabled={pending === 0 || saving}
              onClick={save}
            >
              {saving ? "saving…" : "save dials"}
            </button>
          </footer>
        </>
      ) : readError ? null : (
        <p className="baud-memory-note">reading @memory's config…</p>
      )}
    </section>
  );
}
