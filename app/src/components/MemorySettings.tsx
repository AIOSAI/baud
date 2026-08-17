import { useEffect, useRef, useState } from "react";
import {
  memoryConfigPush,
  memoryConfigRead,
  memoryConfigSetDefault,
  memoryConfigWrite,
} from "../host";

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
    // auto_compact_cap is NOT mirrored into editor state any more: it is
    // read-only in v1, and holding an edit buffer for a value nothing can
    // write is how a dead input gets re-added by accident later.
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
    // ROLLOVER COUNTS NO LONGER TRAVEL IN THIS PATCH (round A ruling). They
    // were direct file writes; they are now @memory's `config set-default`,
    // one verb per moved dial, so the 1-100 bounds and the refusal wording
    // come from @memory rather than from a second copy of its rules here.
    // `patch.rollover` stays in the type because the CAP writer still uses
    // the same envelope - it is simply always empty from this panel now.
  }
  const movedDials = config
    ? config.rollover.filter((dial) => {
        const next = counts[dialId(dial.group, dial.key)];
        return Number.isFinite(next) && next !== dial.count;
      })
    : [];
  const pending = patch.caps.length + movedDials.length;

  /**
   * Two lanes, deliberately, and the split is the round's ruling: character
   * caps have no verb behind them and stay on the direct file write; every
   * keep-count goes through @memory's own `config set-default`.
   *
   * The dials run in SEQUENCE, not in parallel - they all edit one shared
   * file, and three concurrent writers to one JSON document is how a config
   * loses a key. Slower by a few hundred milliseconds, and correct.
   *
   * Whatever comes back is the file RE-READ after the verb, so the panel
   * always settles on what @memory's config actually says rather than on what
   * BAUD asked for. That matters more than usual here: a refused verb exits
   * zero, so the read-back is the only honest proof a number moved.
   */
  const save = async () => {
    if (pending === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    try {
      let settled: MemoryConfig | null = null;
      if (patch.caps.length > 0) settled = await memoryConfigWrite(patch);
      for (const dial of movedDials) {
        settled = await memoryConfigSetDefault(dial.key, counts[dialId(dial.group, dial.key)]);
      }
      if (alive.current && settled) {
        adopt(settled);
        setSaved(true);
      }
    } catch (err) {
      if (alive.current) setWriteError(message(err));
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  /**
   * The fleet-wide reset. Two taps, never one: this rewrites the limits of
   * every branch at once and there is no undo verb to offer afterwards.
   */
  const [confirmPush, setConfirmPush] = useState(false);
  const [pushing, setPushing] = useState(false);
  const push = () => {
    if (pushing) return;
    setPushing(true);
    setWriteError(null);
    memoryConfigPush()
      .then((next) => {
        if (!alive.current) return;
        adopt(next);
        setConfirmPush(false);
        setSaved(true);
      })
      .catch((err) => {
        if (alive.current) setWriteError(message(err));
      })
      .finally(() => {
        if (alive.current) setPushing(false);
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

          {/* THE TIMING SENTENCE, corrected this round: there is no daemon
              tick and nothing here is scheduled. A changed limit is applied by
              the next rollover RUN - a compaction hook, a watch, or somebody
              running it by hand. Never promise a clock we do not own. */}
          <p className="baud-memory-note">
            rollover keep-counts · defaults only, written through @memory's own verb.
            A change applies at the next rollover run, and does NOT reach any agent
            until you push.
          </p>

          {config.rollover.map((dial) => {
            const id = dialId(dial.group, dial.key);
            return (
              <label className="baud-settings-row" key={id}>
                <span className="baud-settings-label">{dial.key.replace(/_/g, " ")}</span>
                {number(counts[id], (next) => setCounts({ ...counts, [id]: next }), 1)}
                <span className="baud-settings-hint">kept in {dial.group}</span>
                {/* READ-ONLY IN v1 - @memory displays this dial and does not
                    take a value for it, so BAUD shows the number and offers no
                    box. An input that silently does nothing is worse than no
                    input at all. */}
                {dial.auto_compact_cap !== null ? (
                  <span className="baud-settings-hint">
                    auto-compact cap {dial.auto_compact_cap} · read-only in v1
                  </span>
                ) : null}
              </label>
            );
          })}

          {/* THE EMPTY STATE IS A FACT, NOT A BLANK. Every branch sitting at
              the defaults is the healthy case and the panel should say so out
              loud - an empty region reads as a list that failed to load. */}
          {config.per_branch.length === 0 ? (
            <p className="baud-memory-note">
              no branch overrides · every agent is at the defaults above
            </p>
          ) : null}

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

          {/* THE PUSH. Its copy carries @memory's real semantics, which are
              easy to soften and must not be: changing a default above does NOT
              reach a single agent. Until this button is pressed, every branch
              that already carries an override keeps showing its OLD number.
              That is the whole reason the button exists. */}
          <div className="baud-memory-push">
            <p className="baud-memory-note">
              changing a default does not reach agents · until you push, every agent with
              an override stays at its old number
            </p>
            {confirmPush ? (
              <div className="baud-memory-push-row">
                <span className="baud-memory-warn">
                  this resets ALL {config.per_branch.length || "17"} branches to the defaults —
                  there is no undo
                </span>
                <button
                  type="button"
                  className="baud-settings-save"
                  disabled={pushing}
                  onClick={push}
                >
                  {pushing ? "pushing…" : "yes, reset every agent"}
                </button>
                <button
                  type="button"
                  className="baud-memory-toggle"
                  disabled={pushing}
                  onClick={() => setConfirmPush(false)}
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="baud-memory-toggle"
                title="drone @memory rollover push - resets every branch's limits to the defaults"
                onClick={() => setConfirmPush(true)}
              >
                push defaults to every agent…
              </button>
            )}
          </div>

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
