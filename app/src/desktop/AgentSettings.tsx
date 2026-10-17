import { useEffect, useRef, useState } from "react";
import { agentSettingsRead, agentSettingsWrite, memoryConfigRead, memoryConfigSet } from "../host";

import type {
  AgentSettings as Settings,
  AgentSettingsPatch,
  MemoryConfig,
  RolloverDial,
} from "../types";

/**
 * One agent's claude settings, opened from a card's gear: absent keys stay absent, never a guessed default.
 * Reference: docs/desktop/settings.md
 */

/** Where the slider STARTS when the file is silent. Not a claimed default -
 *  claude's own threshold tracks the model and this panel cannot know it. */
const DEFAULT_WINDOW = 350_000;
const WINDOW_MIN = 100_000;
const WINDOW_MAX = 1_000_000;
const WINDOW_STEP = 50_000;

/** Model ids pass through opaque - which ones exist is claude's business and
 *  phase 3 verifies them live. "" is Inherit, which REMOVES the key. */
const MODELS: { value: string; label: string }[] = [
  { value: "", label: "Inherit (operator default)" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "fable", label: "Fable" },
];

/** 350000 -> "350k". The slider steps in 50k, so this is always exact. */
function thousands(value: number): string {
  return `${Math.round(value / 1000)}k`;
}

/** Tauri rejects with the backend's error string, not an Error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface AgentSettingsProps {
  /** Branch name - the backend resolves it inside the seated fleet itself. */
  agent: string;
  /** The close glyph: data, so the phone can hand in `×` and this stays one component on both faces. */
  closeGlyph?: string;
  onClose: () => void;
}

export default function AgentSettings({ agent, closeGlyph = "✕", onClose }: AgentSettingsProps) {
  const [base, setBase] = useState<Settings | null>(null);
  // null is "the key is absent" on every dial - a position, not a placeholder.
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [contextWindow, setContextWindow] = useState<number | null>(null);
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

  // Mounting IS opening: every open re-reads, so the panel never shows a
  // stale picture of a file claude or the operator changed underneath it.
  useEffect(() => {
    agentSettingsRead(agent)
      .then((next) => {
        if (!alive.current) return;
        adopt(next);
        setReadError(null);
      })
      .catch((err) => {
        if (alive.current) setReadError(message(err));
      });
  }, [agent]);

  // Rollover limits are written only through @memory's verb, never by BAUD touching the file.
  const [memory, setMemory] = useState<MemoryConfig | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [savingLimit, setSavingLimit] = useState<string | null>(null);

  /** Resolves per (group, key), but @memory resolves per group block: a partial block would show a wrong default.
   *  Unreachable while pushes write whole groups; the fix is @memory answering `config get @branch` in JSON. */
  const adoptMemory = (next: MemoryConfig) => {
    setMemory(next);
    const mine = next.per_branch.find((entry) => entry.branch === agent);
    const effective: Record<string, number> = {};
    for (const dial of next.rollover) {
      const override = mine?.dials.find((each) => each.group === dial.group && each.key === dial.key);
      effective[dial.key] = override ? override.count : dial.count;
    }
    setLimits(effective);
  };

  useEffect(() => {
    memoryConfigRead()
      .then((next) => {
        if (!alive.current) return;
        adoptMemory(next);
        setMemoryError(null);
      })
      .catch((err) => {
        if (alive.current) setMemoryError(message(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  /** Is this dial the agent's own number, or the fleet default it inherits? */
  const overridden = (dial: RolloverDial): boolean => {
    const mine = memory?.per_branch.find((entry) => entry.branch === agent);
    return Boolean(mine?.dials.some((each) => each.group === dial.group && each.key === dial.key));
  };

  const commitLimit = (dial: RolloverDial) => {
    const next = limits[dial.key];
    if (!Number.isFinite(next) || savingLimit) return;
    const current = memory?.per_branch
      .find((entry) => entry.branch === agent)
      ?.dials.find((each) => each.group === dial.group && each.key === dial.key)?.count;
    if (next === (current ?? dial.count)) return;
    setSavingLimit(dial.key);
    setMemoryError(null);
    memoryConfigSet(agent, dial.key, next)
      .then((fresh) => {
        // The re-read is the only proof the number moved: @memory's refusals exit zero.
        if (alive.current) adoptMemory(fresh);
      })
      .catch((err) => {
        if (alive.current) setMemoryError(message(err));
      })
      .finally(() => {
        if (alive.current) setSavingLimit(null);
      });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function adopt(next: Settings) {
    setBase(next);
    setModel(next.model ?? "");
    setEnabled(next.auto_compact_enabled);
    setContextWindow(next.auto_compact_window);
  }

  /** "On" also stamps a threshold: without one the operator would read a number the file never carried. */
  function chooseEnabled(next: boolean | null) {
    setEnabled(next);
    if (next === true && contextWindow === null) setContextWindow(DEFAULT_WINDOW);
    if (next === null) setContextWindow(null);
  }

  // What the FILE says - absent stays absent, so it can be told from a value.
  const wasModel = base?.model ?? "";
  const wasEnabled = base?.auto_compact_enabled ?? null;
  const wasWindow = base?.auto_compact_window ?? null;

  // null on any field means REMOVE the key.
  const patch: AgentSettingsPatch = {};
  if (base) {
    if (model !== wasModel) patch.model = model === "" ? null : model;
    if (enabled !== wasEnabled) patch.auto_compact_enabled = enabled;
    if (contextWindow !== wasWindow) patch.auto_compact_window = contextWindow;
  }
  const pending = Object.keys(patch).length;

  // An unlisted model on file stays listed: rendering it as Inherit would let one save delete the key.
  const options = MODELS.some((option) => option.value === wasModel)
    ? MODELS
    : [...MODELS, { value: wasModel, label: wasModel }];

  const save = () => {
    if (pending === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    agentSettingsWrite(agent, patch)
      .then((next) => {
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

  return (
    <div className="baud-settings-scrim" onPointerDown={onClose}>
      <div
        className="baud-settings-panel"
        role="dialog"
        aria-label={`${agent} settings`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="baud-settings-head">
          <span className="baud-settings-title">{agent} · settings</span>
          <button
            type="button"
            className="baud-settings-close"
            title="close - nothing is written until save"
            onClick={onClose}
          >
            {closeGlyph}
          </button>
        </header>

        <label className="baud-settings-row">
          <span className="baud-settings-label">model</span>
          <select
            className="baud-settings-select"
            value={model}
            disabled={!base}
            onChange={(event) => setModel(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="baud-settings-row">
          <span className="baud-settings-label">auto-compact</span>
          <select
            className="baud-settings-select"
            value={enabled === null ? "" : enabled ? "on" : "off"}
            disabled={!base}
            title={
              enabled === null
                ? "no key on file - claude's own threshold applies, and it follows the model"
                : enabled
                  ? "compaction on - claude summarizes and keeps going"
                  : "compaction off - the session runs to the context wall"
            }
            onChange={(event) =>
              chooseEnabled(event.target.value === "" ? null : event.target.value === "on")
            }
          >
            <option value="">Inherit (claude decides)</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <span className="baud-settings-state">
            {enabled === null ? "not set" : enabled ? "on" : "off"}
          </span>
        </label>

        {/* Kept visible while compaction is off: the threshold is still what
            the file says, and hiding it would read as "unset". */}
        <label
          className={`baud-settings-row ${contextWindow === null || enabled === false ? "baud-settings-row-off" : ""}`}
        >
          <span className="baud-settings-label">threshold</span>
          <input
            type="range"
            className="baud-settings-slider"
            min={WINDOW_MIN}
            max={WINDOW_MAX}
            step={WINDOW_STEP}
            value={contextWindow ?? DEFAULT_WINDOW}
            disabled={!base || contextWindow === null}
            onChange={(event) => setContextWindow(Number(event.target.value))}
          />
          <span className="baud-settings-readout">
            {contextWindow === null ? "not set" : thousands(contextWindow)}
          </span>
        </label>

        {/* Limits commit on blur, not with save: save writes claude's file, these live in @memory's config. */}
        <div className="baud-settings-row baud-settings-row-head">
          <span className="baud-settings-label">memory limits</span>
          <span className="baud-settings-hint">
            entries kept before rollover · applies at the next rollover run
          </span>
        </div>
        {memoryError ? (
          <p className="baud-settings-error" role="alert">
            memory limits: {memoryError}
          </p>
        ) : null}
        {memory
          ? memory.rollover.map((dial) => (
              <label className="baud-settings-row" key={`${dial.group}/${dial.key}`}>
                <span className="baud-settings-label">{dial.key.replace(/_/g, " ")}</span>
                <input
                  type="number"
                  className="baud-settings-number"
                  min={1}
                  max={100}
                  step={1}
                  disabled={savingLimit !== null}
                  value={Number.isFinite(limits[dial.key]) ? limits[dial.key] : ""}
                  onChange={(event) =>
                    setLimits({ ...limits, [dial.key]: event.target.valueAsNumber })
                  }
                  onBlur={() => commitLimit(dial)}
                />
                <span className="baud-settings-hint">
                  {savingLimit === dial.key
                    ? "saving…"
                    : overridden(dial)
                      ? `override · fleet default ${dial.count}`
                      : "default"}
                </span>
              </label>
            ))
          : memoryError
            ? null
            : (
                <p className="baud-settings-hint">reading @memory's limits…</p>
              )}

        {readError ? (
          <p className="baud-settings-error" role="alert">
            read failed: {readError}
          </p>
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
            {pending > 0
              ? `${pending} change(s) pending`
              : saved
                ? "saved"
                : readError
                  ? "nothing can be written until that file reads"
                  : "no changes"}
          </span>
          <button
            type="button"
            className="baud-settings-save"
            disabled={pending === 0 || saving}
            onClick={save}
          >
            {saving ? "saving…" : "save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
