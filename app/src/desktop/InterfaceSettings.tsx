import { useEffect, useRef, useState } from "react";
import { baudSettingsRead, baudSettingsWrite, hooksSoundGet, hooksSoundSet } from "../host";

import type { BaudSettings } from "../types";

/**
 * BAUD's own interface settings (`.aipass/baud.settings.json`), the header gear.
 * Reference: docs/desktop/settings.md
 */

/** What the app does when the file says nothing. */
export const DEFAULT_POLL_MS = 5000;
export const DEFAULT_BELL_MAX = 200;

/** A file carrying a value not on offer keeps it (see withCurrent). */
const POLL_CHOICES = [2000, 5000, 10_000, 30_000];
const RETENTION_CHOICES = [50, 100, 200];

/** Sanity fences for hand-edited values - a 0ms poll would spin the app. */
const POLL_MIN = 1000;
const POLL_MAX = 300_000;
const RETENTION_MIN = 1;
const RETENTION_MAX = 500;

/** The settings the app actually runs on, resolved once, in one place. */
export interface InterfacePrefs {
  startupAgent: string | null;
  pollMs: number;
  bellMax: number;
  bellSound: boolean;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : fallback;
}

/** Absence and nonsense both become the default: the file is hand-editable. */
export function interfacePrefs(settings: BaudSettings | null): InterfacePrefs {
  return {
    startupAgent:
      typeof settings?.startup_agent === "string" && settings.startup_agent !== ""
        ? settings.startup_agent
        : null,
    pollMs: bounded(settings?.poll_interval_ms, POLL_MIN, POLL_MAX, DEFAULT_POLL_MS),
    bellMax: bounded(settings?.bell_max_events, RETENTION_MIN, RETENTION_MAX, DEFAULT_BELL_MAX),
    bellSound: settings?.bell_sound === true,
  };
}

/** Tauri rejects with the backend's error string, not an Error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function seconds(ms: number): string {
  return `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)}s`;
}

/** A stored value the panel does not offer stays listed, so a save never silently rewrites it. */
function withCurrent<T>(
  choices: T[],
  current: T,
  label: (value: T) => string,
): { value: T; label: string }[] {
  const options = choices.map((value) => ({ value, label: label(value) }));
  return choices.includes(current) ? options : [...options, { value: current, label: label(current) }];
}

interface InterfaceControlsProps {
  /** Fleet names for the startup list, in card order. */
  agents: string[];
  /** What the app is running on right now - the panel opens on the truth. */
  settings: BaudSettings;
  /** A save landed: the whole document, exactly as the backend wrote it. */
  onSaved: (settings: BaudSettings) => void;
}

interface InterfaceSettingsProps extends InterfaceControlsProps {
  /** The close button's glyph. Absent is `✕`; the phone hands in `×`. */
  closeGlyph?: string;
  /** Close button and click-away, when they differ from Escape (`onClose`); the phone's Escape goes back one level. */
  onDismiss?: () => void;
  onClose: () => void;
}

/** The rows themselves, chrome-free, for a surface that carries its own. */
export function InterfaceControls({ agents, settings, onSaved }: InterfaceControlsProps) {
  const [base, setBase] = useState<BaudSettings>(settings);
  const opening = interfacePrefs(settings);
  const [startupAgent, setStartupAgent] = useState<string>(opening.startupAgent ?? "");
  const [pollMs, setPollMs] = useState(opening.pollMs);
  const [bellMax, setBellMax] = useState(opening.bellMax);
  const [bellSound, setBellSound] = useState(opening.bellSound);

  // Null until the live read lands: a toggle that guesses would flip the fleet.
  const [hooksActive, setHooksActive] = useState<boolean | null>(null);
  const [hooksError, setHooksError] = useState<string | null>(null);

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
    baudSettingsRead()
      .then((next) => {
        if (!alive.current) return;
        adopt(next);
        setReadError(null);
      })
      .catch((err) => {
        if (alive.current) setReadError(message(err));
      });

    hooksSoundGet()
      .then((active) => {
        if (alive.current) setHooksActive(active);
      })
      .catch((err) => {
        if (alive.current) setHooksError(message(err));
      });
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function adopt(next: BaudSettings) {
    const prefs = interfacePrefs(next);
    setBase(next);
    setStartupAgent(prefs.startupAgent ?? "");
    setPollMs(prefs.pollMs);
    setBellMax(prefs.bellMax);
    setBellSound(prefs.bellSound);
  }

  // "None (empty)" maps to null, which REMOVES the key rather than storing a blank.
  const was = interfacePrefs(base);
  const chosenAgent = startupAgent === "" ? null : startupAgent;
  const patch: BaudSettings = {};
  if (chosenAgent !== was.startupAgent) patch.startup_agent = chosenAgent;
  if (pollMs !== was.pollMs) patch.poll_interval_ms = pollMs;
  if (bellMax !== was.bellMax) patch.bell_max_events = bellMax;
  if (bellSound !== was.bellSound) patch.bell_sound = bellSound;
  const pending = Object.keys(patch).length;

  // A stored agent with no card here stays listed rather than reading as "None".
  const agentOptions =
    was.startupAgent && !agents.includes(was.startupAgent)
      ? [...agents, was.startupAgent]
      : agents;

  const save = () => {
    if (pending === 0 || saving) return;
    setSaving(true);
    setWriteError(null);
    baudSettingsWrite(patch)
      .then((next) => {
        onSaved(next);
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

  // The flag file is the truth: the reply corrects the optimistic flip.
  const flipHooks = () => {
    if (hooksActive === null) return;
    const previous = hooksActive;
    const next = !previous;
    setHooksActive(next);
    setHooksError(null);
    hooksSoundSet(next)
      .then((state) => {
        if (alive.current) setHooksActive(state);
      })
      .catch((err) => {
        if (!alive.current) return;
        setHooksActive(previous);
        setHooksError(message(err));
      });
  };

  return (
    <>
      <label className="baud-settings-row">
        <span className="baud-settings-label">startup agent</span>
        <select
          className="baud-settings-select"
          value={startupAgent}
          title="opened once, when BAUD starts - attached if it is live, resumed if it has history"
          onChange={(event) => setStartupAgent(event.target.value)}
        >
          <option value="">None (empty)</option>
          {agentOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="baud-settings-row">
        <span className="baud-settings-label">poll every</span>
        <select
          className="baud-settings-select"
          value={pollMs}
          title="how often the fleet snapshot and the bell refresh"
          onChange={(event) => setPollMs(Number(event.target.value))}
        >
          {withCurrent(POLL_CHOICES, pollMs, seconds).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="baud-settings-row">
        <span className="baud-settings-label">bell keeps</span>
        <select
          className="baud-settings-select"
          value={bellMax}
          title="how many notification events the bell keeps - the feed file itself is ai_mail's"
          onChange={(event) => setBellMax(Number(event.target.value))}
        >
          {withCurrent(RETENTION_CHOICES, bellMax, (value) => `${value} events`).map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
        </select>
      </label>

      <div className="baud-settings-row">
        <span className="baud-settings-label">bell chime</span>
        <button
          type="button"
          role="switch"
          aria-checked={bellSound}
          className={`baud-settings-switch ${bellSound ? "baud-settings-switch-on" : ""}`}
          title={
            bellSound
              ? "a short blip when new events arrive"
              : "the bell stays silent - the badge is the only signal"
          }
          onClick={() => setBellSound((current) => !current)}
        >
          <span className="baud-settings-knob" aria-hidden="true" />
        </button>
        <span className="baud-settings-state">{bellSound ? "on" : "off"}</span>
      </div>

      {/* @hooks' flag file IS the state: flips on click, never on save. */}
      <div className="baud-settings-row">
        <span className="baud-settings-label">hook sounds</span>
        <button
          type="button"
          role="switch"
          aria-checked={hooksActive === true}
          className={`baud-settings-switch ${hooksActive ? "baud-settings-switch-on" : ""}`}
          title={
            hooksActive === null
              ? "reading the mute flag…"
              : hooksActive
                ? "AIPass hook sounds are on - click to mute the whole fleet"
                : "AIPass hook sounds are muted - click to bring them back"
          }
          disabled={hooksActive === null}
          onClick={flipHooks}
        >
          <span className="baud-settings-knob" aria-hidden="true" />
        </button>
        <span className="baud-settings-state">
          {hooksActive === null ? "…" : hooksActive ? "on" : "muted"}
        </span>
        <span className="baud-settings-hint">resets on reboot</span>
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
      {hooksError ? (
        <p className="baud-settings-error" role="alert">
          hook sounds: {hooksError}
        </p>
      ) : null}

      <footer className="baud-settings-foot">
        <span
          className={`baud-settings-note ${saved && pending === 0 ? "baud-settings-note-saved" : ""}`}
        >
          {pending > 0 ? `${pending} change(s) pending` : saved ? "saved" : "no changes"}
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
    </>
  );
}

/** The controls wearing their own scrim and title bar, as the phone opens them; the desk's dialog carries its own chrome. */
export default function InterfaceSettings({
  agents,
  settings,
  onSaved,
  closeGlyph = "✕",
  onDismiss,
  onClose,
}: InterfaceSettingsProps) {
  const dismiss = onDismiss ?? onClose;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="baud-settings-scrim" onPointerDown={dismiss}>
      <div
        className="baud-settings-panel baud-interface-panel"
        role="dialog"
        aria-label="interface settings"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="baud-settings-head">
          <span className="baud-settings-title">BAUD · interface</span>
          <button
            type="button"
            className="baud-settings-close"
            title="close - nothing is written until save"
            onClick={dismiss}
          >
            {closeGlyph}
          </button>
        </header>

        <InterfaceControls agents={agents} settings={settings} onSaved={onSaved} />
      </div>
    </div>
  );
}
