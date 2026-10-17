import { useEffect, useRef, useState } from "react";

// A named import, so the bundler ships the version string and not the dependency list.
import { version as BAUD_VERSION } from "../../package.json";
import { baudSettingsRead, baudSettingsWrite } from "../host";
import { apiOrigin } from "../host/transport.http";
import InterfaceSettings from "../desktop/InterfaceSettings";
import MemorySettings from "../desktop/MemorySettings";
import type { BaudSettings } from "../types";
import { useSystemBack } from "./lib/systemBack";
import { type Scope, scopeRefusal } from "./lib/verbs";

/** The phone's own settings: a home of doors, one screen behind each. Reference: docs/phone/settings-nav.md */


/** Which screen is on; `null` is home, and "interface" renders home under the desk's panel. */
type SectionId = "terminal" | "interface" | "memory" | "connection" | "about";

interface Section {
  id: SectionId;
  label: string;
  summary: string;
}

/**
 * The home screen, entirely. No loose controls at home: a new setting joins a section or adds one.
 * Agent settings stay off this list - they are per-citizen and live on the card.
 */
const SECTIONS: readonly Section[] = [
  {
    id: "terminal",
    label: "terminal",
    summary: "scroll speed — this face only",
  },
  {
    id: "interface",
    label: "interface",
    // Poll, bell keep and chime are not wired on the phone; the summary says they apply to the desktop.
    summary:
      "startup agent, hook sounds — shared with the desktop · poll every, bell keeps, bell chime apply to the desktop only",
  },
  {
    id: "memory",
    label: "memory",
    summary: "fleet rollover defaults, per-agent overrides — @memory's config · character caps are set at the desktop",
  },
  {
    id: "connection",
    label: "connection",
    summary: "token scope, server, sign out",
  },
  {
    id: "about",
    label: "about",
    summary: "version and build",
  },
];


/** 100 is the built-in feel; absence and nonsense land here, so an unset key changes nothing. */
export const SCROLL_NEUTRAL = 100;

export const SCROLL_MIN = 50;
export const SCROLL_MAX = 400;

/** The speeds on offer; a file carrying another value keeps it (`withCurrent`). */
const SCROLL_CHOICES = [50, 75, 100, 150, 200, 300, 400];

/** The scroll percent the terminal runs on; out of range falls back to neutral, never clamped (a 4000 is a typo). */
export function scrollPercent(settings: BaudSettings | null): number {
  const value = settings?.terminal_scroll_percent;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= SCROLL_MIN &&
    value <= SCROLL_MAX
    ? Math.round(value)
    : SCROLL_NEUTRAL;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A value the file carries but the panel does not offer stays listed (InterfaceSettings.tsx's rule, re-stated). */
function withCurrent(choices: number[], current: number): { value: number; label: string }[] {
  const label = (value: number) => (value === SCROLL_NEUTRAL ? `${value}% · default` : `${value}%`);
  const options = choices.map((value) => ({ value, label: label(value) }));
  return choices.includes(current) ? options : [...options, { value: current, label: label(current) }];
}


/** The emitted chunk this face runs from; null in dev, where the url is a `.tsx` source, so the row is omitted. */
function bundleName(): string | null {
  try {
    const name = new URL(import.meta.url).pathname.split("/").filter(Boolean).pop();
    return name && name.endsWith(".js") ? name : null;
  } catch {
    return null;
  }
}


interface PhoneSettingsProps {
  agents: string[];
  settings: BaudSettings;
  /** A write on a read token is refused with its reason, never hidden. */
  scope: Scope;
  /** Has the server answered the scope: the connection screen must not report a default as fact. */
  scopeKnown: boolean;
  /**
   * The whole document as the server last handed it back, from a read as well as a write:
   * the open room's scroll speed follows the file only if the read travels up.
   */
  onDocument: (settings: BaudSettings) => void;
  /** The face's one sign-out (main.tsx); the connection screen is a second door, not a second implementation. */
  onSignOut: () => void;
  onClose: () => void;
}

export default function PhoneSettings({
  agents,
  settings,
  scope,
  scopeKnown,
  onDocument,
  onSignOut,
  onClose,
}: PhoneSettingsProps) {
  const [screen, setScreen] = useState<SectionId | null>(null);

  // Seeded from the running face so the panel never flashes a default.
  const [fileSpeed, setFileSpeed] = useState(() => scrollPercent(settings));
  const [speed, setSpeed] = useState(fileSpeed);
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
        // Up FIRST, so the open room follows the file even if this panel is unmounting.
        onDocument(next);
        if (!alive.current) return;
        const found = scrollPercent(next);
        setFileSpeed(found);
        setSpeed(found);
        setReadError(null);
      })
      .catch((err) => {
        if (alive.current) setReadError(message(err));
      });
    // Once, on open. `onDocument` is a setState from the parent and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyed on the resolved number, not the object: a failed read hands down a fresh `{}`
  // every render, and depending on it would reset the operator's pick every poll.
  const fromFile = scrollPercent(settings);
  useEffect(() => {
    setFileSpeed(fromFile);
    setSpeed(fromFile);
  }, [fromFile]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (screen === null) onClose();
      else setScreen(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, screen]);

  useSystemBack(screen === null ? onClose : () => setScreen(null));

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  // Only a genuine difference reaches the wire: an untouched panel writes no key.
  const dirty = speed !== fileSpeed;
  const readOnly = scopeRefusal(scope) !== null;
  const refused = readOnly
    ? `this token is ${scope}-scoped — saving a setting needs an operate token`
    : null;

  const save = () => {
    if (!dirty || saving || refused) return;
    setSaving(true);
    setWriteError(null);
    baudSettingsWrite({ terminal_scroll_percent: speed })
      .then((next) => {
        onDocument(next);
        if (!alive.current) return;
        const found = scrollPercent(next);
        setFileSpeed(found);
        setSpeed(found);
        setSaved(true);
      })
      .catch((err) => {
        if (alive.current) setWriteError(message(err));
      })
      .finally(() => {
        if (alive.current) setSaving(false);
      });
  };

  const onHome = screen === null || screen === "interface";
  const section = SECTIONS.find((entry) => entry.id === screen) ?? null;
  const bundle = bundleName();

  return (
    <>
      <div className="baud-settings-scrim" onPointerDown={onClose}>
        <div
          className="baud-settings-panel baud-interface-panel baud-phone-settings-panel"
          role="dialog"
          aria-label="phone settings"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className="baud-settings-head">
            <button
              type="button"
              className="baud-phone-back"
              title={onHome ? "back to the wheel" : "back to settings"}
              onClick={() => (onHome ? onClose() : setScreen(null))}
            >
              ‹ {onHome ? "wheel" : "settings"}
            </button>
            <span className="baud-settings-title">
              {onHome ? "BAUD · settings" : `settings · ${section?.label ?? ""}`}
            </span>
            <button
              type="button"
              className="baud-settings-close"
              title="close - nothing is written until save"
              onClick={onClose}
            >
              ×
            </button>
          </header>

          {onHome ? (
            <>
              {SECTIONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="baud-phone-settings-door"
                  title={entry.summary}
                  onClick={() => setScreen(entry.id)}
                >
                  <span className="baud-settings-label">{entry.label}</span>
                  <span className="baud-phone-settings-doorwords">{entry.summary}</span>
                  <span className="baud-phone-settings-doorarrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
              <span className="baud-settings-hint">
                every setting lives in a section — an agent's own dials stay on its card
              </span>
            </>
          ) : null}

          {screen === "terminal" ? (
            <>
              <label className={`baud-settings-row ${refused ? "baud-settings-row-off" : ""}`}>
                <span className="baud-settings-label">scroll speed</span>
                <select
                  className="baud-settings-select"
                  value={speed}
                  disabled={Boolean(refused)}
                  title={
                    refused ??
                    "how far one finger-swipe moves the room - 100% is the built-in feel, higher reaches back through scrollback faster"
                  }
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  {withCurrent(SCROLL_CHOICES, speed).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="baud-settings-hint">
                applies to the room on screen the moment it saves - no reattach
              </span>

              {refused ? (
                <p className="baud-settings-error" role="alert">
                  {refused}
                </p>
              ) : null}
              {writeError ? (
                <p className="baud-settings-error" role="alert">
                  write failed: {writeError}
                </p>
              ) : null}

              <footer className="baud-settings-foot">
                <span
                  className={`baud-settings-note ${saved && !dirty ? "baud-settings-note-saved" : ""}`}
                >
                  {dirty ? "1 change pending" : saved ? "saved" : "no changes"}
                </span>
                <button
                  type="button"
                  className="baud-settings-save"
                  disabled={!dirty || saving || Boolean(refused)}
                  onClick={save}
                >
                  {saving ? "saving…" : "save"}
                </button>
              </footer>
            </>
          ) : null}

          {/* The desk's own MemorySettings, so a cap read here and at the desk is one number. */}
          {screen === "memory" ? (
            <div className="baud-settings-leaf">
              {/* This face has no caps lane, so the panel says where caps are set. */}
              <MemorySettings capsAtDesktop />
            </div>
          ) : null}

          {screen === "connection" ? (
            <>
              <div className="baud-settings-row">
                <span className="baud-settings-label">token</span>
                <span className="baud-phone-settings-value">
                  {scopeKnown ? `${scope} scope` : "asking the server…"}
                </span>
              </div>
              <span className="baud-settings-hint">
                {scopeKnown
                  ? readOnly
                    ? "reads only — verbs and settings refuse with their reason"
                    : "verbs may fire and settings may be written from this face"
                  : "the server has not answered whoami yet"}
              </span>

              <div className="baud-settings-row">
                <span className="baud-settings-label">server</span>
                <span className="baud-phone-settings-value">{apiOrigin()}</span>
              </div>
              <span className="baud-settings-hint">where this face reaches /v1</span>

              {/* The header chip's handler; no confirm, because the chip has never had one. */}
              <button
                type="button"
                className="baud-phone-settings-door baud-phone-settings-door-danger"
                title="forget this phone's token — the paste screen asks again"
                onClick={onSignOut}
              >
                <span className="baud-settings-label">sign out</span>
                <span className="baud-phone-settings-doorwords">
                  forget the token on this phone
                </span>
              </button>
            </>
          ) : null}

          {screen === "about" ? (
            <>
              <div className="baud-settings-row">
                <span className="baud-settings-label">BAUD</span>
                <span className="baud-phone-settings-value">v{BAUD_VERSION}</span>
              </div>
              {bundle ? (
                <div className="baud-settings-row">
                  <span className="baud-settings-label">bundle</span>
                  <span className="baud-phone-settings-value">{bundle}</span>
                </div>
              ) : null}
              <span className="baud-settings-hint">
                version from the build; bundle is the file this face is running from
              </span>
            </>
          ) : null}

          {readError ? (
            <p className="baud-settings-error" role="alert">
              read failed: {readError}
            </p>
          ) : null}
        </div>
      </div>

      {/* The desk's panel covers this one (same z-index, later in the DOM). Its `×` and
          click-away close settings outright; Escape and `‹ settings` go back one level. */}
      {screen === "interface" ? (
        <InterfaceSettings
          agents={agents}
          settings={settings}
          onSaved={onDocument}
          closeGlyph="×"
          onDismiss={onClose}
          onClose={() => setScreen(null)}
        />
      ) : null}
    </>
  );
}
