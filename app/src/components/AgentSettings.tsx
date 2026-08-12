import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { AgentSettings as Settings, AgentSettingsPatch } from "../types";

/**
 * One agent's settings (m11 phase 2): the gear on a card opens this, and it
 * patches claude's own `<branch>/.claude/settings.local.json` through the
 * backend's surgical door - three keys touched, every other key the operator
 * keeps in that file handed back untouched.
 *
 * A centered overlay rather than a Bell-style anchored shade: the fleet strip
 * scrolls sideways with `overflow-y: hidden`, so a panel hung under a card
 * would be clipped at the strip's edge and would ride away with the scroll.
 * The scrim is the click-away surface (Escape closes too), and because a scrim
 * always covers the fleet, two panels can never be open at once.
 *
 * DIRTY TRACKING is the whole reason the patch is three-state. A field is sent
 * only when the operator's value differs from what the file EFFECTIVELY says
 * today - file value if the key is there, claude's own default if it is not.
 * So an untouched slider stamps nothing: the panel showing 350k for a branch
 * whose file is silent is a reading, not a value the operator chose.
 */

/** Where the slider sits when the file says nothing - claude's own default. */
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
  onClose: () => void;
}

export default function AgentSettings({ agent, onClose }: AgentSettingsProps) {
  // What the file says right now; null until the read lands (or if it failed).
  const [base, setBase] = useState<Settings | null>(null);
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [contextWindow, setContextWindow] = useState(DEFAULT_WINDOW);
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
    invoke<Settings>("agent_settings_read", { agent })
      .then((next) => {
        if (!alive.current) return;
        adopt(next);
        setReadError(null);
      })
      .catch((err) => {
        if (alive.current) setReadError(message(err));
      });
  }, [agent]);

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
    setEnabled(next.auto_compact_enabled ?? true);
    setContextWindow(next.auto_compact_window ?? DEFAULT_WINDOW);
  }

  // The effective state - the file's value, or what claude does without one.
  const wasModel = base?.model ?? "";
  const wasEnabled = base?.auto_compact_enabled ?? true;
  const wasWindow = base?.auto_compact_window ?? DEFAULT_WINDOW;

  // Only genuine differences reach the wire. Inherit is the one field that
  // maps to null (remove the key); the other two have no inherit position, so
  // they only ever set a value.
  const patch: AgentSettingsPatch = {};
  if (base) {
    if (model !== wasModel) patch.model = model === "" ? null : model;
    if (enabled !== wasEnabled) patch.auto_compact_enabled = enabled;
    if (contextWindow !== wasWindow) patch.auto_compact_window = contextWindow;
  }
  const pending = Object.keys(patch).length;

  // A model the file already carries that this panel does not offer stays
  // listed verbatim - dropping it would render as Inherit and lie about the
  // file, and one careless save would then delete a key nobody meant to touch.
  const options = MODELS.some((option) => option.value === wasModel)
    ? MODELS
    : [...MODELS, { value: wasModel, label: wasModel }];

  const save = () => {
    if (pending === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    invoke<Settings>("agent_settings_write", { agent, patch })
      .then((next) => {
        if (!alive.current) return;
        // What came back is what is on disk - adopting it clears dirty.
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
            ✕
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

        <div className="baud-settings-row">
          <span className="baud-settings-label">auto-compact</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className={`baud-settings-switch ${enabled ? "baud-settings-switch-on" : ""}`}
            title={
              enabled
                ? "compaction on - claude summarizes and keeps going"
                : "compaction off - the session runs to the context wall"
            }
            disabled={!base}
            onClick={() => setEnabled((current) => !current)}
          >
            <span className="baud-settings-knob" aria-hidden="true" />
          </button>
          <span className="baud-settings-state">{enabled ? "on" : "off"}</span>
        </div>

        {/* Kept visible while compaction is off: the threshold is still what
            the file says, and hiding it would read as "unset". */}
        <label className={`baud-settings-row ${enabled ? "" : "baud-settings-row-off"}`}>
          <span className="baud-settings-label">threshold</span>
          <input
            type="range"
            className="baud-settings-slider"
            min={WINDOW_MIN}
            max={WINDOW_MAX}
            step={WINDOW_STEP}
            value={contextWindow}
            disabled={!base || !enabled}
            onChange={(event) => setContextWindow(Number(event.target.value))}
          />
          <span className="baud-settings-readout">{thousands(contextWindow)}</span>
        </label>

        <div className="baud-settings-row baud-settings-row-off">
          <span className="baud-settings-label">memory caps</span>
          <span className="baud-settings-soon">
            Rollover caps — coming with @memory support
          </span>
        </div>

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
          {/* A fresh edit outranks the fading "saved" - the note always
              describes what the save button would do right now. */}
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
