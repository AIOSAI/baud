import { useEffect, useRef, useState } from "react";

// The version BAUD was BUILT at, from the one file that carries it. `version`
// is a named import so the bundler keeps that string and nothing else - a
// default import would ship the dependency list to a phone that has no use for
// it. This is a build-time constant on purpose: a running face cannot ask a
// server what version its own bundle is, and inventing an answer is worse than
// having none.
import { version as BAUD_VERSION } from "../../package.json";
import { baudSettingsRead, baudSettingsWrite } from "../host";
import { apiOrigin } from "../host/transport.http";
import InterfaceSettings from "../desktop/InterfaceSettings";
import MemorySettings from "../desktop/MemorySettings";
import type { BaudSettings } from "../types";
import { type Scope, scopeRefusal } from "./lib/verbs";

/**
 * THE PHONE'S OWN SETTINGS SURFACE - the header gear's first screen.
 *
 * WHY THIS FILE EXISTS AT ALL, since the phone deliberately mounted the DESK'S
 * `InterfaceSettings` and the note there is still right ("Two settings screens
 * drifting apart over one file is exactly the bug this avoids"):
 *
 * Patrick asked for terminal scroll speed in BAUD's settings. That knob is
 * PHONE-ONLY - the desk scrolls with a wheel its OS already tunes, and this
 * round is fenced to the phone, so a row in the shared panel would have shipped
 * a desktop control nobody ruled on. The two honest shapes were "a second gear
 * in the header" or "one gear, one screen deeper", and a second gear is how a
 * face ends up with two places called settings. So the gear opens THIS, the
 * interface panel is one tap in, and it arrives UNMODIFIED - the anti-drift
 * argument is untouched, because there is still exactly one implementation of
 * startup agent, poll cadence, bell and hook sounds.
 *
 * A DESKTOP CONTROL FOR THE SAME KEY IS NOT REFUSED, it is simply not this
 * round's - the field is on the shared document precisely so the desk can grow
 * one later without a migration.
 *
 * Same furniture as its sibling on purpose: the `baud-settings-*` classes come
 * from theme.css, which this face already imports, so this panel and the one
 * behind it are the same object to a thumb.
 *
 * ── THE REORGANIZATION (Patrick, on the first version: "unorganized", the
 * scroll knob loose at the top level, and NO BACK BUTTON) ────────────────────
 *
 * The layout below is the one he approved from a touchable mock
 * (devpulse docs.local/design/passport_mock_20260817.html, screens s-set-*):
 * a HOME that is nothing but doors, and one screen behind each door.
 *
 * The first version was a flat panel that grew a door - which is exactly how a
 * settings screen dies: the second knob lands next to the first because there
 * is nowhere else to put it, and by the fifth nobody can find anything. Naming
 * four sections up front costs one tap and buys a home screen that cannot rot,
 * because a new setting has no loose space to land in. See the RULE at
 * `SECTIONS` - it is enforced by this file's shape, not by anyone remembering
 * it.
 */

/* --------------------------------------------------------- the sections -- */

/** Which screen is on. `null` is HOME - and `"interface"` renders home too,
 *  because the interface screen is the desk's own panel mounted on top of it
 *  (see the mount at the bottom). */
type SectionId = "terminal" | "interface" | "memory" | "connection" | "about";

interface Section {
  id: SectionId;
  /** The door's word, and the screen's title after the dot. */
  label: string;
  /** What is behind the door, in the operator's words - a door that only says
   *  "interface" makes you open it to find out whether it holds what you came
   *  for, which on a phone costs a tap and a reorientation. Summaries name what
   *  is THERE, never what is planned: a promise on a door is a bug report. */
  summary: string;
}

/**
 * THE HOME SCREEN, ENTIRELY. Adding a section is adding an entry here plus a
 * block for its body in the panel below - never a change to the home layout,
 * which is a loop over this array and nothing else.
 *
 * RULE, and it is the point of the whole reorganization: NO LOOSE CONTROLS AT
 * HOME LEVEL, EVER. Every setting lives inside a section; a new setting either
 * joins one of these or adds a row here with a screen of its own. Home renders
 * no control that writes anything, so there is no space for one to drift into.
 *
 * AGENT SETTINGS ARE NOT HERE and must not be added: claude's model, its
 * permissions and its launch flags belong to ONE agent each and live on that
 * agent's card, where the thing they configure is on screen. A fleet-wide gear
 * is the wrong address for a per-citizen dial.
 *
 * THE MEMORY DIALS ARE THE OPPOSITE CASE and that is why they earned a row of
 * their own here. They were mounted inside the interface panel, which made a
 * door about this face's look and feel the address for @memory's config - and
 * those numbers are FLEET-WIDE, one file every citizen lives under. A row here
 * is where a fleet-wide dial belongs; the per-agent overrides it writes stay
 * read-only, and the card is where an agent's OWN limits will land.
 *
 * ORDER IS ARGUED, NOT ALPHABETICAL: the face's own knobs first (terminal,
 * interface), then the fleet's config below them, then what this phone is
 * connected to, then what it is. Reading down the list goes from nearest to
 * furthest from the thumb holding it.
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
    /* THREE OF THE FIVE ROWS DO NOTHING HERE, and the door says so (DPLAN-0414
       A#9). The phone polls at its own fixed `POLL_MS` (lib/pollers.ts), keeps
       `FEED_KEEP` events (lib/feed.ts) and has no chime: "poll every", "bell
       keeps" and "bell chime" save to the shared file and change only the
       desktop. Not wired here - that was not ruled. */
    summary:
      "startup agent, hook sounds — shared with the desktop · poll every, bell keeps, bell chime apply to the desktop only",
  },
  {
    id: "memory",
    label: "memory",
    // No "entry caps" here: this face has no caps lane, and the panel inside
    // says where they are set (DPLAN-0414 A#7, the wave 4 note).
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

/* ------------------------------------------------------- terminal · scroll */

/** 100 IS TODAY'S FEEL, EXACTLY. Absence and nonsense both land here, and the
 *  phone's TerminalSheet keeps its own constants as that same baseline - so an
 *  unset key changes nothing rather than handing the knob a default of its
 *  own. */
export const SCROLL_NEUTRAL = 100;

/** Sanity fences for a hand-edited file, in the desk's own spirit: below half
 *  speed the pan stops reaching back through scrollback at all, and past 4x one
 *  thumb-flick throws the room further than anyone can read. */
export const SCROLL_MIN = 50;
export const SCROLL_MAX = 400;

/** The speeds on offer. A file carrying something else keeps it - see below. */
const SCROLL_CHOICES = [50, 75, 100, 150, 200, 300, 400];

/**
 * What the terminal actually runs on, resolved in ONE place.
 *
 * `bounded()` in InterfaceSettings.tsx:45 is the pattern and the semantics are
 * copied deliberately, out-of-range included: a nonsense value falls back to
 * neutral rather than being CLAMPED to an edge, because a hand-edited 4000 is
 * far more likely to be a typo than a request for the fastest scroll in the
 * building, and silently honouring the nearest legal reading of a typo is how
 * an operator ends up fighting a file they cannot see.
 */
export function scrollPercent(settings: BaudSettings | null): number {
  const value = settings?.terminal_scroll_percent;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= SCROLL_MIN &&
    value <= SCROLL_MAX
    ? Math.round(value)
    : SCROLL_NEUTRAL;
}

/** The host rejects with its own sentence; render it, never a paraphrase. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A value the file carries but this panel does not offer stays listed - the
 *  desk's own rule (InterfaceSettings.tsx:80), re-stated here rather than
 *  imported because that helper is module-local to a file this round may not
 *  touch. Same three lines, same reason: the panel must never render as
 *  something the operator did not choose. */
function withCurrent(choices: number[], current: number): { value: number; label: string }[] {
  const label = (value: number) => (value === SCROLL_NEUTRAL ? `${value}% · default` : `${value}%`);
  const options = choices.map((value) => ({ value, label: label(value) }));
  return choices.includes(current) ? options : [...options, { value: current, label: label(current) }];
}

/* ---------------------------------------------------------------- about -- */

/**
 * THE FILE THIS FACE IS ACTUALLY RUNNING FROM, asked at runtime.
 *
 * `import.meta.url` is this module's own url, which after a build is the
 * emitted chunk - the hashed `phone-XXXXXXXX.js` @api is serving right now.
 * That is the one honest way to name it: the hash changes every build, so a
 * literal in the source would be a lie the moment it was written, and the
 * about screen exists precisely so Patrick can check WHICH bundle a phone
 * picked up after a deploy.
 *
 * IN DEV THERE IS NO BUNDLE - the url is the `.tsx` source vite is serving
 * module by module - so this returns null and the row is OMITTED rather than
 * showing a source file under the word "bundle". An absent row is honest; a
 * wrong one is not.
 */
function bundleName(): string | null {
  try {
    const name = new URL(import.meta.url).pathname.split("/").filter(Boolean).pop();
    return name && name.endsWith(".js") ? name : null;
  } catch {
    return null;
  }
}

/*
 * NO TREE ROW (DPLAN-0414 A#1; the owner, 14:20: "Just remove the dirty tree
 * line."). The About screen used to print the commit the bundle was built from
 * and whether that tree was dirty - FPLAN-0446's deploy receipt, read through a
 * `treeStamp()` here. It was a developer's check on a user's screen. The record
 * itself belongs where the deploy check reads it - the served bundle, grepped
 * for `baud-tree` - and the `__BAUD_TREE__` define in `vite.config.phone.ts`
 * stays. Nothing on this screen reads it any more, so the function left with
 * the row.
 *
 * MIND THE DEFINE: vite substitutes it where source names it, and this file was
 * the only place that did. With no reader left here, the `baud-tree` string
 * reaches the bundle only if some other module names `__BAUD_TREE__`.
 */

/* ------------------------------------------------------------- the panel -- */

interface PhoneSettingsProps {
  /** Fleet names, forwarded to the interface panel's startup list. */
  agents: string[];
  /** What the face is running on right now - the panel opens on the truth. */
  settings: BaudSettings;
  /** This token's reach. An operate door on a read token is REFUSED WITH ITS
   *  REASON, never hidden - guard 1 of verbs.ts, applied to a write that is
   *  every bit as much an operate call as a verb is. */
  scope: Scope;
  /** Has the server ANSWERED what the scope is (main.tsx). The connection
   *  screen is the one place that has to tell "read" from "not asked yet"
   *  apart: everywhere else both mean the same safe thing, but a screen whose
   *  whole job is to report the token must not report a default as a fact. */
  scopeKnown: boolean;
  /**
   * The whole document as the server last handed it back - from a READ as well
   * as a write, which is the difference from the desk's `onSaved`.
   *
   * The desk's panel re-reads on open and keeps the answer to itself; that is
   * harmless there, where nothing outside the panel runs on the document. Here
   * the terminal DOES: a scroll speed saved at the desk five minutes ago has to
   * reach the open room, and it can only do that if the read travels up.
   */
  onDocument: (settings: BaudSettings) => void;
  /** THE FACE'S ONE SIGN-OUT, handed down from main.tsx - the same function the
   *  header's chip has always called. The connection screen gives it a second
   *  DOOR, never a second implementation: forgetting a token in two places is
   *  how one of them ends up forgetting less than the other. */
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
  /** `null` is home. Every section is one level deep - the mock's shape, and
   *  the reason one back control can always name where it goes. */
  const [screen, setScreen] = useState<SectionId | null>(null);

  // What the FILE says, and what the operator has picked. Seeded from the
  // running face so the panel never flashes a default, then confirmed by the
  // read below.
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

  // Mounting IS opening - the desk's discipline, same words. The document may
  // have been written at the desk, or by the panel one tap in, since this face
  // last read it.
  useEffect(() => {
    baudSettingsRead()
      .then((next) => {
        // Up FIRST, so the open room follows the file even if this panel is
        // already unmounting behind a fast thumb.
        onDocument(next);
        if (!alive.current) return;
        const found = scrollPercent(next);
        setFileSpeed(found);
        setSpeed(found);
        setReadError(null);
      })
      .catch((err) => {
        // The face's own copy stays on screen - it came from a read too.
        if (alive.current) setReadError(message(err));
      });
    // Once, on open. `onDocument` is a setState from the parent and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The document changed underneath - the panel one tap in saved something, or
  // the read above landed. Adopt it: the file is the truth, not this state.
  //
  // KEYED ON THE RESOLVED NUMBER, NOT THE DOCUMENT OBJECT, and that is a bug
  // fix rather than a style: the parent passes `baudSettings ?? {}`, so a face
  // whose settings read FAILED hands this panel a brand-new empty object on
  // every render - and every poll is a render. Depending on the object would
  // have reset the operator's pick every ten seconds, on exactly the face that
  // is already having a bad day. A number only changes when the file does.
  const fromFile = scrollPercent(settings);
  useEffect(() => {
    setFileSpeed(fromFile);
    setSpeed(fromFile);
  }, [fromFile]);

  // ESCAPE GOES BACK, NOT OUT - the keyboard saying what the back chip says.
  // From a section it lands on home; from home it closes. A desk keyboard on a
  // phone bundle is rare but it is the same gesture, and a key that skipped a
  // level would disagree with the button next to it.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (screen === null) onClose();
      else setScreen(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, screen]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  // Only a genuine difference reaches the wire - an untouched panel writes no
  // key, so an operator who opens the gear to read the poll cadence never
  // stamps a scroll speed into a document that had none.
  const dirty = speed !== fileSpeed;
  /** One question, asked once: does this token reach past reading. The terminal
   *  screen turns it into a refusal sentence, the connection screen into a
   *  description of the token - two renderings, never two judgements. */
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
        // What came back is the whole document as written. The face takes the
        // same copy, which is what carries the new speed into the open room.
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

  /** The interface screen IS the desk's panel, so home stays underneath it. */
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
          {/* THE HEAD, AND THE THING THAT WAS MISSING. Patrick's first word on
              this screen was that it had no back button; every other screen on
              this face opens with one, so this one does too - and it NAMES
              where it goes rather than saying "back", because from a section
              and from home it goes to two different places. */}
          <header className="baud-settings-head">
            <button
              type="button"
              className="baud-phone-back"
              title={onHome ? "close settings" : "back to settings"}
              onClick={() => (onHome ? onClose() : setScreen(null))}
            >
              ‹ {onHome ? "close" : "settings"}
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
              ✕
            </button>
          </header>

          {/* HOME: doors, and not one control. See the RULE at SECTIONS. */}
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

          {/* TERMINAL: the scroll knob, moved here off the home screen it was
              loose on. Same control, same semantics, same one write. */}
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

              {/* THE SAVE FOOT BELONGS TO THIS SCREEN, not the panel: it is the
                  one screen with something to write, and a "no changes" note
                  under a list of doors is furniture that means nothing. */}
              <footer className="baud-settings-foot">
                <span
                  className={`baud-settings-note ${saved && !dirty ? "baud-settings-note-saved" : ""}`}
                >
                  {/* The sibling says "change(s)" because it counts four fields
                      and cannot know which; this screen has one, so it says
                      one. */}
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

          {/* MEMORY: @memory's dials, the SAME component the desk mounts in its
              own settings dialog - one implementation of the fleet's limits, so
              a cap read on a phone and a cap read at the desk can never be two
              different numbers. It sits INSIDE this panel rather than covering
              it the way the interface panel does, because it carries no chrome
              of its own: the head above is already its back button and its
              title, which is what every other section here gets. */}
          {screen === "memory" ? (
            <div className="baud-settings-leaf">
              {/* `capsAtDesktop`: this face has no character-caps lane (its
                  route serves the rollover dials only), so the panel's caps
                  section says where they are set instead of heading an empty
                  list (DPLAN-0414 A#7). The desk never passes it. */}
              <MemorySettings capsAtDesktop />
            </div>
          ) : null}

          {/* CONNECTION: what this face is holding and what it is talking to -
              both READ-ONLY, both answered by the parts that actually know
              (the token's scope came from the server's whoami, the address
              from the transport), and the one action that ends the session. */}
          {screen === "connection" ? (
            <>
              <div className="baud-settings-row">
                <span className="baud-settings-label">token</span>
                <span className="baud-phone-settings-value">
                  {/* Not-yet-answered is its own state, said out loud - see
                      `scopeKnown`. */}
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

              {/* THE SAME HANDLER THE HEADER CHIP CALLS (PhoneApp's `onSignOut`,
                  main.tsx:106) - it forgets the token and drops the face at the
                  door. Red, because it is the one row here that takes something
                  away; no confirm, because the header's chip has never had one
                  and inventing a second behaviour for the same action would be
                  its own kind of drift. */}
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

          {/* ABOUT: only facts this face can actually find out. Anything it
              cannot gets no row at all - see `bundleName`. */}
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

          {/* PANEL-LEVEL, on every screen: a settings read that failed means
              nothing here is confirmed, whichever door you are behind. */}
          {readError ? (
            <p className="baud-settings-error" role="alert">
              read failed: {readError}
            </p>
          ) : null}
        </div>
      </div>

      {/* THE INTERFACE SCREEN - the desk's panel, mounted EXACTLY as it was
          before this round: one implementation of startup agent, poll cadence,
          bell and hook sounds, seated behind its own row instead of a loose
          door. It covers this panel rather than replacing it: its scrim is
          fixed at the same z-index and later in the DOM, so it paints on top
          and its own ✕ or click-away lands back on settings home. */}
      {screen === "interface" ? (
        <InterfaceSettings
          agents={agents}
          settings={settings}
          onSaved={onDocument}
          onClose={() => setScreen(null)}
        />
      ) : null}
    </>
  );
}
