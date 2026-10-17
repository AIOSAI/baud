import { useEffect, useRef, useState } from "react";
import {
  memoryConfigPush,
  memoryConfigRead,
  memoryConfigSetDefault,
  memoryConfigWrite,
} from "../host";
import { CAPS_AT_DESKTOP, capsLine, enforcementWarns, pushScope } from "../memoryCopy";

import type { MemoryConfig, MemoryConfigPatch } from "../types";

/**
 * The memory dials: @memory's fleet-wide config, saved separately from BAUD's own settings.
 * Reference: docs/desktop/settings.md
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

interface MemorySettingsProps {
  /** The mounting face has no caps lane (the phone), so an empty caps list means "set elsewhere". */
  capsAtDesktop?: boolean;
}

export default function MemorySettings({ capsAtDesktop = false }: MemorySettingsProps = {}) {
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
    // auto_compact_cap is read-only in v1: no edit buffer, so no dead input creeps back.
  }

  // A cleared field (NaN) counts as untouched rather than written as zero.
  const patch: MemoryConfigPatch = { caps: [], rollover: [] };
  if (config) {
    for (const limit of config.entry_limits) {
      const next = caps[limit.key];
      if (Number.isFinite(next) && next !== limit.max_chars) {
        patch.caps.push({ key: limit.key, max_chars: next });
      }
    }
    // Keep-counts go through @memory's `config set-default`, not this patch, so
    // `patch.rollover` is always empty from this panel.
  }
  const movedDials = config
    ? config.rollover.filter((dial) => {
        const next = counts[dialId(dial.group, dial.key)];
        return Number.isFinite(next) && next !== dial.count;
      })
    : [];
  const pending = patch.caps.length + movedDials.length;

  /**
   * Caps write the file directly; keep-counts go through @memory's verb.
   * The dials run in SEQUENCE: concurrent writers to one JSON file lose keys.
   * A refused verb exits zero, so the re-read config is the only proof a number moved.
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

  /** The fleet-wide reset: two taps, because there is no undo. */
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
        {/* No path, no row: the phone reads a route, not a file. */}
        {config?.path ? (
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
          {/* The warning shows only on an enforcement flag READ as false; the phone's is unknown. */}
          {capsLine(config.entry_limits.length, capsAtDesktop) === "desktop" ? (
            <p className="baud-memory-note">{CAPS_AT_DESKTOP}</p>
          ) : (
            <p className="baud-memory-note">
              entry caps · read live by the enforcement hook, so a save binds on the next
              memory write
              {enforcementWarns(config.enforced) ? (
                <strong className="baud-memory-warn"> · enforcement is OFF in this file</strong>
              ) : null}
            </p>
          )}

          {config.entry_limits.map((limit) => (
            <label className="baud-settings-row" key={limit.key}>
              <span className="baud-settings-label">{limit.key.replace(/_/g, " ")}</span>
              {number(caps[limit.key], (next) => setCaps({ ...caps, [limit.key]: next }), 1)}
              <span className="baud-settings-hint">
                chars · {capHint(limit.file, limit.container, limit.field)}
              </span>
            </label>
          ))}

          {/* No daemon tick: limits apply at the next rollover RUN. Never promise a clock we do not own. */}
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
                {dial.auto_compact_cap !== null ? (
                  <span className="baud-settings-hint">
                    auto-compact cap {dial.auto_compact_cap} · read-only in v1
                  </span>
                ) : null}
              </label>
            );
          })}

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

          {/* @memory's real semantics, unsoftened: a changed default reaches no agent until the push. */}
          <div className="baud-memory-push">
            <p className="baud-memory-note">
              changing a default does not reach agents · until you push, every agent with
              an override stays at its old number
            </p>
            {confirmPush ? (
              <div className="baud-memory-push-row">
                <span className="baud-memory-warn">
                  this resets {pushScope(config.per_branch.length)} to the defaults — there is
                  no undo
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
