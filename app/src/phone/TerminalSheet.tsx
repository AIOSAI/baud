/**
 * The phone's terminal: a REAL client attached to a REAL room (FPLAN-0414 seam
 * 3, as amended).
 *
 * ATTACH, NOT REPAINT. This file spent one evening as a polling screenshot -
 * `capture-pane` once a second, painted into a write-only xterm - and Patrick
 * cut that design before it shipped: "attach needs to work just like on
 * desktop." He is right, and the difference is not cosmetic. Repaint-polling
 * shows a PICTURE of the room that updates. Attach gives you THE ROOM.
 * Scrollback, colour, cursor position, vim, less, claude's own full-screen
 * interface - all of it works here because nobody reimplements any of it. The
 * bytes on this socket are the bytes on the desk.
 *
 * SAME ROOM, DIFFERENT WIRE. The desktop runs `tmux new-session -A -t
 * baud-<branch>` in a pty (`pty.rs`); @api runs the same command in a pty on
 * the host and puts a socket in front of it. Two clients, one session - which
 * is exactly what tmux is for, and why the desk and the pocket show the same
 * screen without either one knowing about the other.
 *
 * CLOSING IS FREE. Disconnect sends SIGHUP to the tmux CLIENT: that is a
 * detach. The session, the agent inside it and its scrollback survive. Ending a
 * room stays exactly one door - `--end-room` - and nothing in this sheet can
 * reach it. Cursor-first falls out for free: no socket, no cost, no poll to
 * remember to stop.
 *
 * THE SHEET IS A VERB NOW, and that is a real change from the repaint design.
 * Watching a picture was a read; an attached room is a shell prompt with the
 * operator's own credentials at it, so it needs OPERATE. Under a read token the
 * sheet still opens and says so, because a scope-refused UI that simply vanishes
 * is indistinguishable from breakage (learning #389, now doctrine).
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { deliveryText } from "../deliver";
import { openRoomSocket, uploadImage } from "../host";
import { HostError } from "../host/transport.http";
import type { BranchStatus } from "../types";
/* The knob's bounds live with the panel that sets them - the desk's own shape,
   where `App.tsx` reads `interfacePrefs` out of `InterfaceSettings`. One
   direction only: the panel knows nothing about this sheet. */
import { SCROLL_MAX, SCROLL_MIN, SCROLL_NEUTRAL } from "./PhoneSettings";
import { type PhoneMode, launchCommand, typeOnAttach } from "./rooms";
import { type Scope, scopeRefusal } from "./verbs";

/**
 * The key bar - the keys a thumb needs and a soft keyboard hides (DPLAN-0301).
 *
 * REAL CONTROL BYTES, not key names. The repaint design sent `"C-c"` to a
 * backend that interpreted it, and the interpreting was the whole reason that
 * path needed an allowlist. Here each button writes the exact byte a keyboard
 * writes, into a stream that interprets nothing - so there is no allowlist to
 * enforce and nothing to get wrong. `\x1b[A` is what the Up arrow puts on the
 * wire; the room decides what it means, as it does for the desk.
 *
 * STICKY MODIFIERS joined the row 08-16 (Patrick, stranded in codex: "alt is
 * missing... I see u have ctrl c but no ctrl on its own right"). The model is
 * Termux's, verified against its source: TAP latches for exactly the next
 * key, LONG-PRESS locks until tapped off - one CTRL chip is every Ctrl-combo,
 * where the old row bought one combo per chip. ⇧tab is pre-baked because it
 * cycles modes in BOTH claude and codex and cannot be composed - a phone
 * keyboard has no Tab for a sticky Shift to grab.
 */
type Sticky = "idle" | "latched" | "locked";

/** xterm's own modified-arrow parameter: 1 + shift·1 + alt·2 + ctrl·4. */
function arrowParam(ctrl: boolean, alt: boolean): number {
  return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

/**
 * One typed character under the active stickies, as the bytes a hardware
 * keyboard would put on the wire: Ctrl maps into the C0 range (`a` → 0x01,
 * space → NUL, `?` → DEL), Alt is an ESC prefix, and both at once
 * control-map first then prefix - xterm's own order. A character Ctrl has
 * no byte for (digits, most punctuation) returns null: the caller passes
 * it through UNTRANSFORMED and keeps the latch, because inventing a byte
 * would be interpreting, which this bar does not do.
 */
function modifiedChar(char: string, ctrl: boolean, alt: boolean): string | null {
  let out = char;
  if (ctrl) {
    const code = char.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64);
    else if (char === " ") out = "\x00";
    else if (char === "?") out = "\x7f";
    else return null;
  }
  return alt ? `\x1b${out}` : out;
}

interface ChipSpec {
  bytes: string;
  label: string;
  title: string;
  /** Long-press alternate - Termux's popup model, flattened to one hold. */
  hold?: { bytes: string; title: string };
  /** CSI arrow letter - the one chip family that honors latched modifiers. */
  arrow?: "A" | "B" | "C" | "D";
}

/** Left of the stickies: the un-composable keys. */
const CHIPS_LEFT: ReadonlyArray<ChipSpec> = [
  {
    bytes: "\x1b",
    label: "esc",
    title: "escape - interrupt / back out. HOLD: esc esc (rewind in claude, backtrack in codex)",
    hold: { bytes: "\x1b\x1b", title: "esc esc" },
  },
  { bytes: "\x09", label: "tab", title: "Tab - autocomplete (claude), queue a follow-up mid-turn (codex)" },
  { bytes: "\x1b[Z", label: "⇧⇥", title: "Shift+Tab - cycle modes, both claude and codex" },
];

/** Right of the stickies: panic button, arrows, submit. */
const CHIPS_RIGHT: ReadonlyArray<ChipSpec> = [
  // Pre-baked despite sticky CTRL: interrupt is the panic button, and a
  // two-tap race against a runaway process is the wrong shape for one.
  { bytes: "\x03", label: "^C", title: "interrupt - the byte Ctrl+C sends" },
  { bytes: "\x1b[D", label: "←", title: "Left arrow (latched CTRL/ALT modify it)", arrow: "D" },
  { bytes: "\x1b[B", label: "↓", title: "Down arrow - menus, history. Does NOT scroll.", arrow: "B" },
  { bytes: "\x1b[A", label: "↑", title: "Up arrow - menus, history. Does NOT scroll.", arrow: "A" },
  { bytes: "\x1b[C", label: "→", title: "Right arrow (latched CTRL/ALT modify it)", arrow: "C" },
  {
    bytes: "\r",
    label: "⏎",
    title: "submit the line. HOLD: newline WITHOUT submitting (Ctrl+J - the one both TUIs honor)",
    hold: { bytes: "\n", title: "newline, no submit" },
  },
];

/**
 * A chip with an optional long-press lane. Pointer events, not onClick,
 * because the tap-vs-hold decision needs the down-up interval - and the
 * context menu is suppressed or Android's text-selection long-press would
 * fire over the hold.
 */
function HoldButton({
  className,
  title,
  disabled,
  onTap,
  onHold,
  children,
}: {
  className: string;
  title: string;
  disabled: boolean;
  onTap: () => void;
  onHold?: () => void;
  children: ReactNode;
}) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={title}
      onPointerDown={(event) => {
        // NO FOCUS THEFT: a chip press must not pull focus off the terminal
        // (or the compose box) - on a phone, losing focus DISMISSES the soft
        // keyboard, which would slam the keys shut on every chip tap.
        event.preventDefault();
        held.current = false;
        if (!onHold) return;
        cancel();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          held.current = true;
          onHold();
        }, 450);
      }}
      onPointerUp={() => {
        cancel();
        if (!held.current) onTap();
        held.current = false;
      }}
      onPointerLeave={() => {
        cancel();
        held.current = false;
      }}
      onPointerCancel={() => {
        cancel();
        held.current = false;
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  );
}

/**
 * Scrolling the ROOM is the pan gesture's job alone - the ▲/▼ chips retired
 * once touch worked (Patrick: "we dont need them any more u use my fingers").
 *
 * Claude Code is a full-screen TUI: there is no local scrollback to swipe,
 * because the history lives in tmux, not in this xterm. So scrolling means
 * sending the room a WHEEL event and letting tmux's own copy-mode do it -
 * `mouse on` (set when the room is opened) is what makes that lane exist.
 */

/** tmux's own default: `WheelUpPane` sends `-N 5 scroll-up` in copy-mode.
 *  Read off `list-keys`, not assumed. Rebinding it makes a pan faster or
 *  slower - never broken - so this is a tuning constant, not a contract. */
const LINES_PER_NOTCH = 5;

/**
 * How much faster than 1:1 a pan travels. Patrick: "scrolling work. its slow
 * but an improvement."
 *
 * The first cut tracked the thumb exactly - a pan moved the text by the
 * distance the finger moved - which is right for a document you are reading
 * and wrong for scrollback you are reaching BACK through, where the thumb runs
 * out of screen long before the history runs out. At 3x one comfortable swipe
 * is about one screenful, which is the unit people actually think in.
 *
 * A feel constant, not a correctness one. Patrick votes with his thumb.
 *
 * AND NOW HE VOTES WITH A SETTING TOO: `terminal_scroll_percent` scales this
 * number, so 3 stopped being the answer and became the BASELINE the percentage
 * is a percentage OF. It stays here rather than moving into the settings file
 * because an absent key must leave this file computing exactly what it
 * computed before the knob existed - see the pan handler.
 */
const PAN_ACCELERATION = 3;

/**
 * Terminal type size: default, and the range the zoom chips travel.
 *
 * DOWN FROM 11, on Patrick's "smaller" - and the default matters more than the
 * range because most sessions never touch the chips. 10px is the smallest size
 * that still reads as text rather than texture on a 420px-wide phone; below
 * that the operator is squinting at a room they cannot act on, which buys rows
 * at the cost of the thing the rows are for.
 *
 * ZOOMING OUT BUYS REAL COLUMNS. That is only true because the resize lane
 * works: fewer pixels per cell means more cells, FitAddon measures them, and
 * the room follows because it is opened `window-size smallest`. Before that fix
 * this control would have been a lie told to a deaf room.
 */
/**
 * How many rows at the bottom of the grid count as "the place you type".
 *
 * A terminal is a character grid and nothing in it announces where the TUI's
 * input box is - there is no element to ask, only cells. So this is a
 * heuristic with a number, and the number is the tunable: claude's compose box
 * is a bordered box plus its hint line, which is four rows on a phone-sized
 * grid, and five gives a thumb a row of margin without reaching into the
 * transcript. A bare shell needs no special case - its prompt is the bottom
 * line, so "the bottom rows" is already the right answer there too.
 */
const COMMENT_ROWS = 5;

const DEFAULT_FONT = 10;
const MIN_FONT = 7;
const MAX_FONT = 18;

/** What a close code means to the person holding the phone (@api's contract).
 *
 *  1008 is the caller's and fixable, 1011 is the host's and is not - the same
 *  split as 400 vs 503, and the same argument as BAUD's exit-1 vs exit-2. Both
 *  arrive on an ESTABLISHED socket precisely so the sentence can be RENDERED:
 *  a refusal at handshake time is invisible to a browser, which would put the
 *  answer somewhere the operator can never read it. */
function closeSentence(event: CloseEvent): string | null {
  if (event.code === 1008) return event.reason || "the room refused this request";
  if (event.code === 1011) return event.reason || "the host could not open the room";
  // 1000/1001/1005/1006: a detach, a backgrounded phone, a dropped link. The
  // room is fine and saying "error" about it would be a lie.
  return null;
}

/**
 * What a dropped write means, in the operator's words.
 *
 * ONE SENTENCE, USED EVERYWHERE. Every control on this sheet promises the same
 * thing - bytes reach the room - so every one of them fails the same way and
 * must say so identically. A per-call-site paraphrase is how one of them ends
 * up saying nothing at all, which is the bug this whole pass exists to kill.
 */
const DETACHED =
  "not sent: the room is detached. Reattach and try again - nothing was lost in the room.";

interface TerminalSheetProps {
  branch: BranchStatus;
  /** Which door the operator pressed. Attach is not a third mode - a launch IS
   *  an attach, so a live room arrives here as `resume` that types nothing. */
  mode: PhoneMode;
  /**
   * ONE command line typed into this shell when it opens, or null for a bare
   * prompt. SHELL PANES ONLY.
   *
   * The desktop's own prop, same words (`InquiryPane.tsx:40`): "The caller
   * decides: the card's `?` sends the branch's help command, the terminal
   * buttons send nothing and hand over an empty shell." A launch mode never
   * carries one - its line comes from `launchCommand`, which is the terminal
   * slot and stays the only place anything claude-specific lives.
   */
  command?: string | null;
  scope: Scope;
  /**
   * How fast a finger-pan scrolls this room, as a PERCENT of the constants
   * below - `BaudSettings.terminal_scroll_percent`, resolved by the caller.
   *
   * OPTIONAL AND NEUTRAL AT 100, which is what makes `LINES_PER_NOTCH` and
   * `PAN_ACCELERATION` a baseline rather than a default this prop overrides: a
   * sheet mounted without it, and a document with no such key, both compute the
   * exact arithmetic this file computed before the knob existed.
   *
   * IT FOLLOWS THE FILE LIVE, through a ref rather than the attach effect's
   * dependencies - the same mechanism, and the same reason, as `font`: a scroll
   * speed that reattached the socket would be a remount hiding inside a
   * preference.
   */
  scrollPercent?: number;
  /**
   * NO `onClose`. The sheet used to own its own way out, in the header row that
   * this round deleted - detach is a door on the agent's card now, because that
   * is the one place it can be shown only for the room actually on screen. A
   * component that cannot close itself is the honest shape of that: the sheet
   * does not decide when it goes, the fleet does.
   */
  /**
   * The compose field took or lost focus - i.e. the soft keyboard is about to
   * eat half the screen. Reported UP because the thing that has to make room is
   * the rail, which this sheet neither owns nor should know about. The sheet's
   * own lanes - touch scroll, resize, send - are untouched by this; it is one
   * notification on an input that had none.
   */
  onComposeFocus?: (focused: boolean) => void;
}

export default function TerminalSheet({
  branch,
  mode,
  command = null,
  scope,
  scrollPercent = SCROLL_NEUTRAL,
  onComposeFocus,
}: TerminalSheetProps) {
  /**
   * THE CARD AS IT WAS WHEN THE DOOR WAS PRESSED. Frozen deliberately.
   *
   * The fleet re-polls every ten seconds and hands down a NEW card object each
   * time. Depending on that object means the attach effect re-runs on every
   * poll: a fresh socket, a fresh pty, and the claude launch line typed into
   * the room AGAIN - once every ten seconds, for as long as the sheet is open.
   * Found by measuring the wire, not by reading the code: the harness caught
   * the same launch bytes twice in one attach.
   *
   * Freezing is also what the semantics want. Which door to offer and whether
   * to type a command are judgments made about the room the operator was
   * LOOKING at when they pressed it. A poll arriving mid-session does not get
   * to re-decide them - the attached room is authoritative from then on, and
   * what is happening inside it is on the screen.
   */
  const attachedTo = useRef(branch).current;
  /**
   * THE LINE THIS DOOR ASKED FOR, frozen with the card and for the same reason:
   * it is a judgment made about the room the operator was LOOKING at when the
   * door was pressed, and a later render does not get to re-decide it.
   */
  const opener = useRef(command).current;
  /**
   * What to call this room in status lines. An agent room is its branch's
   * name; a shell says so — and the project-root shell has NO branch, so the
   * name would be an empty string pointing at nothing.
   */
  const roomLabel =
    mode === "shell"
      ? attachedTo.name
        ? `shell @${attachedTo.name}`
        : `shell (${attachedTo.project || "project"})`
      : attachedTo.name;
  const host = useRef<HTMLDivElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const term = useRef<XTerm | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  /** The compose box, reffed so its height can follow its content. */
  const compose = useRef<HTMLTextAreaElement | null>(null);
  const [status, setStatus] = useState("opening the room…");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** Is the socket OPEN right now? Real state, because the UI must reflect it. */
  const [live, setLive] = useState(false);
  /** Bump to open a fresh socket onto the same room. */
  const [attempt, setAttempt] = useState(0);
  /**
   * The launch line is typed ONCE PER SHEET, never once per socket. A reattach
   * lands in a room that already has whatever the first attach started; typing
   * the command again would be the double-claude hazard arriving through the
   * back door, after all the work spent closing the front one.
   */
  const launched = useRef(false);
  /** A delivery that outlived its socket, waiting for the next open. */
  const pending = useRef<{ bytes: string; path: string } | null>(null);
  /** The fitter and the resize sender, reached the same way and for the same
   *  reason: zoom has to re-measure and re-declare the geometry, and both of
   *  those live inside the attach effect. */
  const fitRef = useRef<FitAddon | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const [font, setFont] = useState(DEFAULT_FONT);
  /**
   * The size the terminal was BORN with. Read through a ref so `font` never
   * enters the attach effect's dependencies - if it did, every press of a zoom
   * chip would tear down the socket and reattach, which is a remount hiding
   * inside a font change. Zoom is applied imperatively to the live instance.
   */
  const fontAtMount = useRef(font);
  /**
   * THE SCROLL KNOB, HELD THE WAY ZOOM IS HELD - and for the same reason one
   * line up: the pan handler is CLOSED OVER by the attach effect, so putting
   * the prop in that effect's dependencies would make saving a preference
   * detach and reattach the room.
   *
   * A ref instead, refreshed after every render. The handler reads
   * `speed.current` at the moment a finger moves, which is what makes a save
   * land on the room already on screen with no reattach and no remount.
   *
   * BOUNDED AGAIN HERE, deliberately, though the caller resolved it already:
   * this is the one number in the file that ends up UNDER a division, and a
   * zero arriving from a future caller would not be a wrong feel, it would be
   * an infinite notch count fired at the room.
   */
  const speed = useRef(SCROLL_NEUTRAL);
  useEffect(() => {
    speed.current =
      Number.isFinite(scrollPercent) && scrollPercent >= SCROLL_MIN && scrollPercent <= SCROLL_MAX
        ? scrollPercent
        : SCROLL_NEUTRAL;
  }, [scrollPercent]);
  /**
   * FULLSCREEN IS A CLASS, NEVER A REMOUNT - the whole point of the feature.
   * Patrick asked for the terminal to cover the screen "but not change the
   * layout underneath", and the layout underneath includes the live socket:
   * this sheet is keyed by room, so anything that unmounts it detaches him.
   * A state flag that only decorates the SAME node cannot do that.
   */
  const [full, setFull] = useState(false);

  /* ------------------------------------------------------------------------
   * THE SELECTION LANE. Built as a probe (2026-08-16) and ruled in the same
   * night; the strip that measured it is gone, this is the mechanism it proved.
   * in one go once the route is decided.
   *
   * The question it exists to answer, and nothing else: does Firefox Android
   * feed a CONSTRUCTED MouseEvent into xterm's coordinate math? xterm has a
   * built-in "force local selection, do not forward to the pty" path keyed on
   * shiftKey - SelectionService.shouldForceSelection returns event.shiftKey on
   * non-Mac, and MouseService checks the same flag independently and skips pty
   * forwarding. Touch has no shift key, so the probe forges one.
   *
   * If this works, select-mode needs no xterm internals at all. If it does
   * not, that is equally a result and Route 2 (the accessibility tree) is the
   * answer - saying so plainly is the deliverable either way.
   * --------------------------------------------------------------------- */
  const [selecting, setSelecting] = useState(false);
  /** The armed flag as the touch listeners see it - they are bound once per
   *  attach and must not be torn down and rebuilt to learn about a chip. */
  const selectingRef = useRef(false);
  selectingRef.current = selecting;
  /** What xterm says is selected, and what the copy attempt said back. */
  const [selText, setSelText] = useState("");
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /* ROUND 1b. Patrick's verdict on round 1 was the outcome the four-way
   * framing did not list: the forged events DO drive xterm's coordinate math -
   * selection appears and tracks the finger - and then COLLAPSES around 12-14
   * characters. So Route 1's question is answered yes and the open question is
   * persistence. These are instruments, not features: the strip has to NAME
   * the killer, because the strip is the only readout on the device and
   * Patrick has to be able to read it off the glass and say it back.
   *
   * Everything a drop could be blamed on gets counted, with a timestamp, so
   * the sentence written at the moment of the drop can say which of them had
   * just happened. A counter that stays at zero is as much an answer as one
   * that climbs. */
  /* THE INSTRUMENTS ARE GONE, THE MECHANISM STAYS. Round 1b's strip counted
   * every suspect - peak, outputs, cancels, menus, fits, extra touchdowns -
   * because the question was WHY a drag collapsed at 12-14 characters. That
   * question is answered and the readout was the throwaway; what it proved is
   * now plain behaviour. Two fields survive because they are load-bearing
   * rather than diagnostic: `dragging` gates the forged mouse events and holds
   * the ResizeObserver's fit (a fit mid-drag drops the selection), and
   * `heldFit` is the receipt that says one is owed on lift. */
  const drag = useRef({ dragging: false, heldFit: false });
  const refusal = scopeRefusal(scope);
  /**
   * The sticky modifiers, Termux-exact: latched applies to the next key then
   * clears, locked holds until tapped off. State for the chips' faces, a ref
   * mirror for the onData closure - which is created once per attach and must
   * see the CURRENT position without tearing the socket down to get it.
   */
  const [ctrlMod, setCtrlMod] = useState<Sticky>("idle");
  const [altMod, setAltMod] = useState<Sticky>("idle");
  const mods = useRef({ ctrl: "idle" as Sticky, alt: "idle" as Sticky });
  mods.current = { ctrl: ctrlMod, alt: altMod };

  /**
   * Whether focusing this terminal is allowed to summon the soft keyboard.
   *
   * PATRICK'S RULING, from live use: "any time I touch the terminal the phone
   * keyboard pops up. but in fact the only place I can type is ur comment box.
   * so keyboard should only pop up when i tap the curser in the comment box."
   * The tap-to-focus that made the keyboard reachable on day one had become
   * the thing standing between him and a selection - double-tap picks a word
   * and the keyboard immediately covers it and takes the gesture.
   *
   * THE FIX IS NOT TO STOP THE FOCUS. Focus is load-bearing three ways: it is
   * how a tap reaches tmux as a click (expanding a tool call), how xterm runs
   * its own word-selection, and how the room takes keys at all. Blocking it
   * would trade one broken thing for three. So focus still happens on every
   * tap exactly as before, and what changes is what focus MEANS - the field
   * is told whether it may open a keyboard, before the focus arrives.
   *
   * TWO MECHANISMS, deliberately, because neither is universal. `inputMode =
   * "none"` is the property meant for exactly this and Chrome honours it;
   * `readOnly` is the older behaviour every mobile browser has implemented
   * for longer, and Firefox on the S24 is the acceptance browser. Setting
   * both costs nothing and means the round does not hinge on which one this
   * month's Firefox respects.
   *
   * The cost of `readOnly` while the keyboard is disallowed: xterm's paste and
   * IME composition ride that textarea's own events. Neither is reachable
   * without a keyboard or a paste menu, and both come back the moment the
   * field is a typing field again - which is any tap on the bottom rows.
   */
  const allowKeyboard = useCallback((allowed: boolean) => {
    const field = host.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    if (!field) return;
    field.readOnly = !allowed;
    field.inputMode = allowed ? "text" : "none";
  }, []);

  /** A latch is spent by the keypress it modified; a lock survives it. */
  const consumeLatch = useCallback(() => {
    setCtrlMod((s) => (s === "latched" ? "idle" : s));
    setAltMod((s) => (s === "latched" ? "idle" : s));
  }, []);

  /**
   * The direct-typing lane through the stickies. Single characters transform
   * (that is a keypress); longer strings pass WHOLE and keep the latch - a
   * paste or a word-prediction commit is not the keystroke the operator armed
   * the modifier for, and mangling its first byte would corrupt the rest.
   * Runs on xterm's onData, which is AFTER xterm's own IME handling - so the
   * Android keyboard's compose dance (keydown says "Unidentified", the letter
   * only exists in the composition) is already resolved by the time this sees
   * bytes. That placement is the whole trick.
   */
  const throughMods = useCallback(
    (data: string): string => {
      const { ctrl, alt } = mods.current;
      const ctrlOn = ctrl !== "idle";
      const altOn = alt !== "idle";
      if ((!ctrlOn && !altOn) || data.length !== 1) return data;
      const out = modifiedChar(data, ctrlOn, altOn);
      if (out === null) return data;
      consumeLatch();
      return out;
    },
    [consumeLatch],
  );

  /**
   * Bytes out - and it REPORTS whether they went.
   *
   * The guard was here from the start; returning nothing was the bug. A dead
   * socket made this a silent no-op, so every caller above it went on to claim
   * success: the photo lane rendered "delivered" over a path that never left
   * the phone, and `send()` cleared the operator's typed line into nothing.
   * Patrick found both, live.
   *
   * A refused action must never be silent. That was already this branch's own
   * rule for scope refusals (learning #389) - it applies with exactly the same
   * force to a transport that dropped the bytes, and it did not stop being true
   * because the failure was mine rather than the server's.
   */
  const write = useCallback((bytes: string): boolean => {
    const open = socket.current;
    if (!open || open.readyState !== WebSocket.OPEN) return false;
    // BINARY, always. A text frame can never reach the PTY on @api's side - a
    // test of theirs reads the handler to prove it - and encoding here means
    // multi-byte characters cross as the same bytes a keyboard would produce.
    open.send(new TextEncoder().encode(bytes));
    return true;
  }, []);

  useEffect(() => {
    if (!host.current) return;
    if (refusal) {
      // No socket is opened at all under a read token. The refusal is not a
      // disabled button hiding a live connection - there is nothing behind it.
      setStatus("not attached");
      return;
    }

    const xterm = new XTerm({
      convertEol: false, // a real stream carries its own CR - converting would double it
      fontSize: fontAtMount.current,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace',
      cursorBlink: true,
      // Real scrollback, because this is a real client. The repaint design had
      // to set this to zero and lost the room's history with it.
      scrollback: 2_000,
      theme: { background: "#070a09", foreground: "#d6e2dc" },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host.current);
    fit.fit();
    term.current = xterm;
    fitRef.current = fit;
    // A room opens with the keyboard DOWN. The helper textarea only exists
    // after open(), and the default has to be the refusing one - a room that
    // pops a keyboard the moment it appears is the behaviour this round is
    // here to end, and it would be back on every reattach otherwise.
    allowKeyboard(false);

    let live: WebSocket;
    try {
      live = openRoomSocket(attachedTo.name, attachedTo.project, mode === "shell" ? "shell" : "");
    } catch (cause) {
      setError(cause instanceof HostError ? cause.message : String(cause));
      xterm.dispose();
      term.current = null;
      return;
    }
    // Binary frames as bytes, not Blobs: xterm takes a Uint8Array directly, and
    // decoding to a string here would break UTF-8 split across chunk boundaries.
    live.binaryType = "arraybuffer";
    socket.current = live;

    /** Tell the room how big this client is. The ONLY control verb on the wire. */
    const sendResize = () => {
      if (live.readyState !== WebSocket.OPEN) return;
      const { cols, rows } = xterm;
      if (cols > 0 && rows > 0) {
        live.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };

    live.onopen = () => {
      setLive(true);
      setStatus(`attached · ${roomLabel}`);
      setError(null);
      // FIRST FRAME IS THE SIZE. @api opens the PTY at 80x24 until told
      // otherwise, so anything written before this lands in the wrong geometry.
      //
      // The phone is a REAL client and sizes like one (Amendment 1 withdrew the
      // never-resize-from-the-phone line). The room is opened `window-size
      // smallest` (`pty.rs`), so this resize SETTLES the geometry instead of
      // starting a fight: under tmux's `latest` default the desk took the
      // window back on its next repaint and left the phone rendering a window
      // it could not fit - the stacking status bar and the scattered echo
      // Patrick reported. The desk gets its size back when this client leaves.
      sendResize();
      // The command line, typed only where it can land at a prompt. Sent WITH
      // its newline - the operator pressed a launch door and running it is the
      // point, exactly as `Terminal.tsx` does after `ptyCreate`. ONCE per
      // sheet: a reattach must not re-run it.
      // Positive narrowing, not exclusion: only the two LAUNCH modes ever
      // type. A shell types nothing by design, and a watch never reaches this
      // sheet at all — the compiler holds both facts through this check.
      if (!launched.current && (mode === "resume" || mode === "fresh") && typeOnAttach(attachedTo)) {
        launched.current = true;
        write(`${launchCommand(attachedTo, mode)}\n`);
      }
      // THE CARD'S `?` (08-17): a shell with one line already run in it. The
      // desk does exactly this - `InquiryPane` writes its `command` prop into
      // the pty the moment it opens (`InquiryPane.tsx:178`) - and it is the
      // same byte lane the launch line above rides, so nothing new reaches the
      // room, only a different sentence.
      //
      // SHARES `launched`, not a second flag. The rule is one line per SHEET:
      // a reattach lands in a room that already ran it, and re-running help
      // there would be the launch line's own double-type bug wearing a
      // different word. The two branches are mutually exclusive by mode
      // anyway - PhoneApp only ever hands a command to a shell.
      //
      // NO `typeOnAttach` GUARD, because there is nothing for it to read: that
      // function asks whether a live claude owns the AGENT's room, and this is
      // the `baud-shell-` room next door, which the census does not report on
      // at all. The honest consequence, stated rather than hidden: a shell room
      // the operator left something running in takes this line as input to
      // whatever is running. That is one line into the operator's own shell -
      // the hazard `typeOnAttach` exists for is a second claude, and no `drone
      // --help` can start one.
      if (!launched.current && mode === "shell" && opener) {
        launched.current = true;
        write(`${opener}\n`);
      }
      // A delivery that was stranded by a dead socket goes NOW, on the first
      // open that can carry it. This is the picker case: choosing a photo
      // backgrounds the app, the socket dies while the operator is in the
      // gallery, and the path would otherwise be typed into nothing.
      const waiting = pending.current;
      if (waiting) {
        pending.current = null;
        if (write(waiting.bytes)) setStatus(`delivered · ${waiting.path}`);
      }
    };

    live.onmessage = (event) => {
      // Terminal data is binary in both directions. Anything else on this
      // socket is not room output and is not painted as if it were.
      if (event.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(event.data));
      }
    };

    live.onerror = () => {
      // A browser surfaces no code here. The one thing that refuses BEFORE the
      // socket is established is auth, so this sentence can be specific.
      setError("the room refused this connection - the token was rejected, or the host is unreachable");
    };

    live.onclose = (event) => {
      socket.current = null;
      setLive(false);
      setStatus("detached - the room and whatever runs in it are still there");
      // A stranded delivery is not lost and must not look lost: the file IS on
      // disk, and its path is one reattach away from being typed.
      const waiting = pending.current;
      setError(
        waiting
          ? `the photo is saved at ${waiting.path} but the room detached before it could be typed - reattach to deliver it`
          : closeSentence(event),
      );
    };

    // Real typing from a real keyboard, when the operator has one. Same door as
    // the key bar, and nothing between it and the room.
    /**
     * One wheel notch, as the room's own terminal would report it.
     *
     * SGR (1006) encoding: `ESC [ < Cb ; col ; row M`, Cb 64 = wheel up and
     * 65 = wheel down, coordinates 1-based. tmux's root binding turns a wheel
     * up into `copy-mode -e` and then scrolls it, which is how a full-screen
     * TUI gets scrollback it does not implement itself.
     *
     * REFUSES TO WRITE IF THE ROOM IS NOT LISTENING FOR A MOUSE. Without that
     * guard these bytes are not a scroll, they are TEXT: a room opened before
     * `mouse on` existed would take `[<64;10;20M` straight into claude's input
     * box. That is the mangling this round is here to end, and it would have
     * been me doing it. When the room has no mouse lane, xterm's own buffer
     * scrolls instead - honest, local, and never garbage in the room.
     */
    const wheel = (notches: number, column = 1, row = 1) => {
      if (xterm.modes.mouseTrackingMode === "none") {
        xterm.scrollLines(notches * LINES_PER_NOTCH);
        return false;
      }
      const button = notches < 0 ? 64 : 65;
      const bytes = `\x1b[<${button};${Math.max(1, column)};${Math.max(1, row)}M`;
      for (let sent = 0; sent < Math.abs(notches); sent += 1) write(bytes);
      return true;
    };
    resizeRef.current = sendResize;

    /**
     * A finger pan IS the scroll gesture on a phone, and xterm does not make
     * one: with mouse tracking on it hands touches to the application, and the
     * application here is tmux, which never sees them. So the pan is measured
     * here and paid out in wheel notches.
     *
     * Distance is converted with the room's real cell height (measured off the
     * rendered rows, not guessed from the font size) times tmux's five lines
     * per notch, so the text tracks the thumb at roughly 1:1 instead of
     * flying.
     */
    let panFrom: number | null = null;
    let panRest = 0;
    const rowsElement = () =>
      host.current?.querySelector(".xterm-rows") as HTMLElement | null;
    const cellHeight = () => {
      const rows = rowsElement();
      const measured = rows && xterm.rows ? rows.clientHeight / xterm.rows : 0;
      return measured > 0 ? measured : 14;
    };
    /** Which cell the finger is on. tmux reads these coordinates to decide
     *  WHICH PANE a wheel event belongs to, so a pan in a split room scrolls
     *  the half being touched rather than always the first one. */
    const cellUnder = (clientX: number, clientY: number) => {
      const rows = rowsElement();
      if (!rows || !xterm.cols || !xterm.rows) return { column: 1, row: 1 };
      const box = rows.getBoundingClientRect();
      return {
        column: Math.floor((clientX - box.left) / (box.width / xterm.cols)) + 1,
        row: Math.floor((clientY - box.top) / (box.height / xterm.rows)) + 1,
      };
    };
    /* THE FORGED SHIFT-DRAG. Three rules from the
     * research doc, each of which has a reason:
     *  - preventDefault on touchstart, so the browser never synthesises its own
     *    mouse events and the ordinary tap-forward pipeline stays out of this
     *    gesture entirely.
     *  - mousedown AT THE TERMINAL ELEMENT, bubbling, so SelectionService and
     *    MouseService both see it and both take the shiftKey branch.
     *  - mousemove and mouseup AT DOCUMENT, not the element. SelectionService
     *    binds those on the document for the duration of a gesture, so it
     *    receives them; MouseService's element-bound drag listener does not,
     *    and it is the one that would leak drag reports to tmux mid-gesture
     *    because it does not re-check the force-selection flag per move.
     */
    const forge = (
      target: EventTarget,
      type: "mousedown" | "mousemove" | "mouseup",
      touch: Touch,
      detail = 1,
    ) => {
      target.dispatchEvent(
        new MouseEvent(type, {
          clientX: touch.clientX,
          clientY: touch.clientY,
          screenX: touch.screenX,
          screenY: touch.screenY,
          shiftKey: true,
          button: 0,
          buttons: 1,
          detail,
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    };
    /* Only touches React state when the reading actually CHANGED - a drag
     * fires touchmove tens of times a second, and every one of those was a
     * re-render of this whole sheet before the guard went in. */
    const readSelection = () => {
      const text = xterm.getSelection();
      setSelText((was) => (was === text ? was : text));
    };
    const onTouchStart = (event: TouchEvent) => {
      if (selectingRef.current) {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        const p = drag.current;
        /* A SECOND mousedown CLEARS THE SELECTION - SelectionService starts a
         * new range on every one. So a stray second finger, or a touchstart
         * the browser re-issues mid-gesture, would wipe the drag in progress.
         * Swallowed, never forwarded. */
        if (p.dragging) {
          readSelection();
          return;
        }
        p.dragging = true;
        p.heldFit = false;
        const screenEl = host.current?.querySelector(".xterm-screen") ?? host.current;
        if (screenEl) forge(screenEl, "mousedown", touch);
        return;
      }
      panFrom = event.touches.length === 1 ? event.touches[0].clientY : null;
      panRest = 0;
      // The keyboard decision is made HERE, on touchstart, and the timing is
      // the whole mechanism: the focus that summons the keyboard comes from
      // the mousedown the browser synthesises AFTER this, so by the time
      // xterm focuses its textarea the field already knows whether it is
      // allowed to open a keyboard. Nothing is prevented and nothing is
      // fought - focus still happens exactly as before, which is what keeps
      // the tap-forwards-to-tmux and select-a-word paths intact.
      if (event.touches.length === 1) {
        const at = cellUnder(event.touches[0].clientX, event.touches[0].clientY);
        allowKeyboard(at.row > xterm.rows - COMMENT_ROWS);
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (selectingRef.current) {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        // A move after the gesture was cancelled is not part of the drag, and
        // forging from it would extend a range xterm has already finished.
        if (!drag.current.dragging) return;
        forge(document, "mousemove", touch);
        readSelection();
        return;
      }
      if (panFrom === null || event.touches.length !== 1) return;
      /**
       * ONE KNOB, ONE FEEL - and it is applied HERE, once, at the single place
       * finger pixels become notches. Both scroll paths run through this
       * number, so scaling it scales both by exactly the same factor:
       *
       *   mouse lane on  - `wheel()` sends `notches` SGR events and tmux moves
       *                    5 lines per event, so lines = 5 x notches
       *   mouse lane off - `wheel()` falls back to `scrollLines(notches x 5)`
       *
       * WHICH IS WHY `LINES_PER_NOTCH` IS NOT ALSO MULTIPLIED in that fallback,
       * and the reason is written down at its own declaration: that 5 is a
       * MIRROR of tmux's `WheelUpPane` binding, read off `list-keys`, not a
       * dial this face owns. Scaling it too would scale the local path twice -
       * k x k against the room's k - and the two lanes would disagree about
       * what one swipe means, which is the exact bug the knob exists to avoid.
       *
       * `factor` is 1 EXACTLY at the neutral 100 (100/100, then 3 x 1), so an
       * unset key leaves this arithmetic bit-for-bit what it was.
       */
      const factor = speed.current / SCROLL_NEUTRAL;
      const perNotch = (cellHeight() * LINES_PER_NOTCH) / (PAN_ACCELERATION * factor);
      const travelled = event.touches[0].clientY - panFrom + panRest;
      const notches = Math.trunc(travelled / perNotch);
      if (notches === 0) return;
      // Keep the remainder: dropping it makes a slow drag scroll nothing at
      // all, which reads as "scrolling is broken" rather than "not yet".
      panRest = travelled - notches * perNotch;
      panFrom = event.touches[0].clientY;
      // Finger DOWN uncovers what came before, which is a wheel UP.
      const at = cellUnder(event.touches[0].clientX, event.touches[0].clientY);
      wheel(notches > 0 ? -Math.abs(notches) : Math.abs(notches), at.column, at.row);
      event.preventDefault();
    };
    /* ROUND 1b: touchend and touchcancel no longer share one handler.
     *
     * They shared it in round 1, which meant a browser that TOOK the gesture
     * away mid-drag ended the selection in a way indistinguishable from the
     * operator lifting his finger - silent, and the leading hypothesis for the
     * collapse. The mouseup is still forged on a cancel, because finishing the
     * range xterm already has is better than abandoning it half-open. What
     * changes is that a cancel is now handled as the distinct event it is. */
    const endGesture = (event: TouchEvent) => {
      if (selectingRef.current) {
        const p = drag.current;
        if (!p.dragging) return;
        const touch = event.changedTouches[0];
        // changedTouches, not touches - the finger that just LIFTED is no
        // longer in `touches`, and a mouseup at 0,0 would collapse the range.
        if (touch) {
          event.preventDefault();
          forge(document, "mouseup", touch);
        }
        p.dragging = false;
        readSelection();
        // A fit held back during the drag is paid now: the observer will not
        // fire again on its own, so skipping it outright would leave the room
        // rendering at a stale size until the next real layout change.
        if (p.heldFit) {
          p.heldFit = false;
          try {
            fit.fit();
            sendResize();
          } catch {
            // The sheet is closing. Not a failure.
          }
        }
        return;
      }
      panFrom = null;
      panRest = 0;
    };
    const onTouchEnd = (event: TouchEvent) => endGesture(event);
    const onTouchCancel = (event: TouchEvent) => endGesture(event);
    /* Firefox Android fires the synthetic click even
     * though touchstart was preventDefaulted (Bugzilla 1016480, unlike
     * Chrome), and it fires it at the ORIGINAL touch target however far the
     * finger travelled. So the click is stopped here, in the capture phase,
     * before anything in xterm can act on it. */
    const swallowClick = (event: MouseEvent) => {
      if (!selectingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    };
    /* ROUND 1b - AND THIS ONE IS A FIX, NOT ONLY AN INSTRUMENT. The research
     * doc named contextmenu preventDefault as the documented lane for
     * suppressing Firefox Android's long-press over user-select:none content
     * (Bugzilla 1481923) and round 1 SHIPPED WITHOUT IT. A long press is what
     * a slow careful drag looks like to the browser, and 12-14 characters at
     * that speed is squarely inside the 500-700ms window where it decides the
     * gesture is its own. This one is a FIX and stays; only its counter was
     * an instrument. */
    const onContextMenu = (event: Event) => {
      if (!selectingRef.current) return;
      event.preventDefault();
    };
    const screen = host.current;
    // Not passive: a pan that scrolls the room must not ALSO drag the page.
    screen.addEventListener("touchstart", onTouchStart, { passive: false });
    screen.addEventListener("touchmove", onTouchMove, { passive: false });
    screen.addEventListener("touchend", onTouchEnd, { passive: false });
    screen.addEventListener("touchcancel", onTouchCancel, { passive: false });
    screen.addEventListener("click", swallowClick, true);
    screen.addEventListener("contextmenu", onContextMenu, { passive: false });

    // DIRECT TYPING IS THE PATH HE REACHES FOR FIRST, and it is untouched here:
    // same function, same bytes, nothing added between the keyboard and the
    // room. The only difference is that a keystroke dropped on a dead socket now
    // says so - and it needs saying most on this path, because the terminal
    // echoes nothing back either way, so silence is exactly what a working room
    // looks like while you type into a closed one.
    const typed = xterm.onData((bytes) => {
      if (!write(throughMods(bytes))) setError(DETACHED);
    });
    // Rotate the phone, open the soft keyboard, and the client is a different
    // size. A real client tells the room; it does not silently misreport.
    // BACK IN VIEW = BACK ON THE WIRE. Opening the OS file picker backgrounds
    // the PWA and the platform closes the socket while the operator is in their
    // gallery; returning to a sheet that looks attached but is not is the state
    // that cost Patrick a typed message and a photo. Cursor-first doctrine is
    // unchanged - a socket still lives only while somebody is looking - this is
    // the other half of that sentence, which was missing.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const open = socket.current;
      if (!open || open.readyState !== WebSocket.OPEN) setAttempt((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);

    const observer = new ResizeObserver(() => {
      /* ROUND 1b, AND A HYPOTHESIS NEITHER OF US LISTED: THE PROBE'S OWN
       * A FIT MID-DRAG DROPS THE SELECTION, so a drag holds this observer off.
       * The hypothesis that found it was that the probe's own readout shared
       * this flex column, grew as the selection grew, shrank the terminal and
       * fired this - the instrument destroying its own measurement. The strip
       * is gone and the hold stays, because any layout change during a drag
       * does the same thing. Held, never ignored: the receipt is paid on lift,
       * or the room renders at a stale size until the next real layout. */
      if (drag.current.dragging) {
        drag.current.heldFit = true;
        return;
      }
      try {
        fit.fit();
      } catch {
        // The sheet is closing and the element is gone. Not a failure.
        return;
      }
      sendResize();
    });
    observer.observe(host.current);

    return () => {
      screen.removeEventListener("touchstart", onTouchStart);
      screen.removeEventListener("touchmove", onTouchMove);
      screen.removeEventListener("touchend", onTouchEnd);
      screen.removeEventListener("touchcancel", onTouchCancel);
      screen.removeEventListener("click", swallowClick, true);
      screen.removeEventListener("contextmenu", onContextMenu);
      fitRef.current = null;
      resizeRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      observer.disconnect();
      typed.dispose();
      // Close FIRST, then dispose: the close is the detach and it must go out
      // while the socket still exists.
      live.onclose = null;
      live.close();
      socket.current = null;
      xterm.dispose();
      term.current = null;
    };
    // `opener` is frozen at mount like `attachedTo`, so it can never re-run
    // this effect - it is listed because the effect reads it, not because it
    // moves.
  }, [attachedTo, mode, opener, refusal, write, attempt, throughMods, allowKeyboard]);

  /**
   * THE BELT RIDES ABOVE THE SOFT KEYBOARD (DPLAN-0301, Patrick: "the bottom
   * keys are missing in shell view"). The keyboard shrinks only the VISUAL
   * viewport on modern mobile browsers while fixed/flex bottom bars measure
   * against the full-height LAYOUT viewport - so the row lands behind the
   * keys. This lifts the belt by exactly the hidden height, computed from
   * visualViewport - the one cross-browser lane (Firefox is Patrick's own
   * browser; the Chrome-only VirtualKeyboard API was ruled out for that).
   * Self-correcting on browsers that DO resize the layout viewport: the
   * hidden height computes to zero and the transform clears.
   */
  const belt = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => {
      const strip = belt.current;
      if (!strip) return;
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      strip.style.transform = hidden > 0 ? `translateY(-${hidden}px)` : "";
    };
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    place();
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, []);

  /**
   * Send the staged line: type it, then submit it.
   *
   * TWO WRITES, NOT ONE, and the split is the safety. The literal goes out with
   * no newline anywhere near it; `\r` is a second, separate byte. It is the
   * same property `--send-room` had to enforce in the backend, except a PTY
   * gives it for free - nothing on this path can append a newline on the
   * operator's behalf, so a paste can never run itself.
   */
  function send() {
    const literal = text;
    if (!literal || refusal) return;
    // WRITE FIRST, CLEAR SECOND - and that order is the whole fix. The old
    // order cleared the field and THEN discovered the socket was dead, so
    // Patrick's typed message vanished out of the box into nothing while the
    // sheet sat there looking attached. His words for it were "it would not
    // send", and he was describing the field emptying, which is the one thing
    // that made it look like it had.
    //
    // The text belongs to the operator until the bytes are known to have gone.
    if (!write(literal)) {
      setError(DETACHED);
      return;
    }
    setText("");
    // The submit byte is separate on purpose (above) and can fail on its own.
    // That leaves the line TYPED BUT UNSUBMITTED, which is visible in the room
    // and finishable with the ⏎ chip - so name exactly that, not "not sent".
    if (!write("\r")) {
      setError("the line was typed but not submitted - the room detached mid-send. Reattach and press ⏎.");
    }
  }

  /**
   * Zoom the room's type - and then tell the room, which is the half that makes
   * it real rather than cosmetic.
   *
   * Applied to the LIVE terminal, never by re-creating it: `font` is kept out
   * of the attach effect's dependencies precisely so this cannot become a
   * reattach. Order matters - set the size, re-measure with FitAddon, then send
   * the new cols/rows. Skipping the last step leaves a client rendering a
   * geometry it never declared, which is the same class of bug as the stacking
   * status bar Patrick reported: a client lying about its own size.
   */
  function zoom(step: number) {
    const next = Math.min(MAX_FONT, Math.max(MIN_FONT, font + step));
    if (next === font) return;
    setFont(next);
    const xterm = term.current;
    const fit = fitRef.current;
    if (!xterm || !fit) return;
    xterm.options.fontSize = next;
    try {
      fit.fit();
    } catch {
      // The sheet is closing and the element is gone. Not a failure.
      return;
    }
    resizeRef.current?.();
  }

  // Height follows content: measure after every edit (and after send clears
  // the text, which is what shrinks it back to one line). `auto` first, or
  // scrollHeight reports the OLD height and the box never shrinks.
  useEffect(() => {
    const field = compose.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [text]);

  /* THE COPY LANE.
   *
   * The copy half of the selection, and the whole reason it is written inline
   * rather than in a helper: EVERY STEP RUNS SYNCHRONOUSLY INSIDE THE TAP.
   * `navigator.clipboard` does not exist here - the host serves plain http on
   * a tailnet IP, which is not a secure context - so the lane is the legacy
   * `execCommand`, and that one is spent the instant the handler yields. One
   * await, one promise, one setTimeout anywhere in this function and the user
   * activation is gone and the copy silently does nothing.
   *
   * The scratch field is readOnly with inputMode none for the same reason the
   * terminal's own textarea is: focusing a field to copy out of it must not
   * summon a keyboard over the thing the operator just selected.
   */
  function copySelection() {
    const text = term.current?.getSelection() ?? "";
    if (!text) {
      setCopyNote("nothing selected - drag across a line first");
      return;
    }
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.readOnly = true;
    scratch.inputMode = "none";
    // Off-screen, but NOT hidden: display:none or visibility:hidden makes the
    // field unselectable and the copy silently copies nothing.
    scratch.style.position = "fixed";
    scratch.style.top = "0";
    scratch.style.left = "0";
    scratch.style.opacity = "0";
    scratch.style.pointerEvents = "none";
    document.body.appendChild(scratch);
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    scratch.remove();
    setCopyNote(
      copied
        ? `execCommand said yes - ${text.length} chars. Paste into the box below to prove it.`
        : "execCommand refused - the legacy lane is closed here, so copy needs another route",
    );
  }

  /** A key chip. Same promise as every other control, so the same audit. */
  function press(bytes: string) {
    if (!write(bytes)) setError(DETACHED);
  }

  /** A chip through the stickies: arrows are the one family that combine
   *  (Ctrl+arrow is word-jump/pane-nav in real rooms); everything else on
   *  the row already IS its final bytes. */
  function pressChip(chip: ChipSpec) {
    const { ctrl, alt } = mods.current;
    const ctrlOn = ctrl !== "idle";
    const altOn = alt !== "idle";
    if (chip.arrow && (ctrlOn || altOn)) {
      consumeLatch();
      press(`\x1b[1;${arrowParam(ctrlOn, altOn)}${chip.arrow}`);
      return;
    }
    press(chip.bytes);
  }

  /**
   * Send a photo: put the bytes on the host's disk, then type where they landed.
   *
   * THE PATH IS THE DELIVERY - `screenshot.rs` line 3, and this is that
   * mechanism reached from a pocket instead of from the camera button. Nothing
   * about an image crosses this socket; what crosses is a path, and the agent
   * reads the file itself.
   *
   * `deliveryText` is the DESKTOP's quoting rule, imported rather than
   * reimplemented. A second copy would drift, and this one carries shell
   * semantics - a mis-escaped path does not look wrong on screen, it means
   * something else to the shell.
   *
   * AND NO ENTER. The path lands in the operator's line, wrapped in spaces so it
   * joins whatever they were already typing, and sits there. Submitting is
   * theirs. Third time this rule has carried tonight; it is doctrine.
   */
  async function sendPhoto(file: File) {
    setSending(true);
    setError(null);
    setStatus(`uploading ${file.name}…`);
    try {
      const path = await uploadImage(file);
      const bytes = deliveryText([path]);
      if (write(bytes)) {
        setStatus(`delivered · ${path}`);
      } else {
        // THE PICKER IS THE UNCOVERED STATE. Choosing a photo hands the screen
        // to the OS gallery, the PWA goes to the background, and the platform
        // closes the socket underneath it - so the write lands right when this
        // sheet is least able to notice. It rendered "delivered" over a path
        // that never left the phone.
        //
        // The upload is the durable half: the file IS on the host's disk. So
        // the delivery is QUEUED against the next open socket and a reattach
        // is asked for by name. Nothing here claims a delivery that has not
        // happened, and nothing throws the photo away.
        pending.current = { bytes, path };
        setStatus(`saved · ${path}`);
        setError(`the photo is saved at ${path} but the room detached before it could be typed - reattaching to deliver it`);
        setAttempt((n) => n + 1);
      }
    } catch (cause) {
      // The upload failed, so NOTHING was typed. Say which half broke - an
      // operator who thinks a path is in their line will press Enter on it.
      setError(
        cause instanceof HostError
          ? `photo not sent: ${cause.message}`
          : `photo not sent: ${String(cause)}`,
      );
      setStatus(`attached · ${roomLabel}`);
    } finally {
      setSending(false);
      // Clear the input, or picking the SAME photo twice fires no change event.
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <section className={`baud-phone-term ${full ? "baud-phone-term-full" : ""}`}>
      {/* THE HEADER ROW IS GONE. It cost a permanent row to say three things:
          which room (the rail's ring says it, at zero rows, pointing straight
          down at the terminal), that the room is attached (same ring), and a
          detach button (now a door on that agent's card, where it can only
          appear for the room actually on screen). Patrick counted three visible
          terminal lines under the old chrome; this row was one of them. */}

      {error ? <p className="baud-phone-error">{error}</p> : null}

      {/* Status ONLY when it is not the steady state. "attached - name" is what
          the room looks like when nothing is happening, and a permanent row
          restating that is exactly the rent this round is collecting. An upload
          in flight or a detached socket is news, and news gets a line. */}
      {status.startsWith("attached ·") ? null : (
        <p className="baud-phone-term-status">{status}</p>
      )}

      {/* THE DOOR BACK IN. Every sentence above tells the operator to reattach,
          so there has to be something to press - a diagnosis with no remedy is
          just a nicer way to be stuck. Rendered only while the socket is down,
          because a reattach button on a live room is an invitation to churn a
          working connection. Detached is a normal state here, not an error:
          nothing was lost, the room is still running, and this is one tap. */}
      {!refusal && !live ? (
        <button
          type="button"
          className="baud-phone-term-reattach"
          onClick={() => setAttempt((n) => n + 1)}
        >
          reattach to {roomLabel}
        </button>
      ) : null}

      {/* Refused, never hidden, and never a dead button: a read token gets the
          sheet, the reason, and no socket. */}
      {refusal ? (
        <p className="baud-phone-term-refused">
          read-only session — {refusal}. An attached room is a shell prompt, so it needs operate.
        </p>
      ) : null}

      <div className="baud-phone-term-screen">
        <div ref={host} className="baud-phone-term-host" />
        {/* ON the screen, not above it: a corner affordance costs no row, and
            in fullscreen it is also the way back out, which is exactly where a
            thumb looks for it. The toggle only sets a class on the section this
            button lives inside - the terminal, its xterm and its socket are the
            same objects before and after, which is the entire requirement. */}
        <button
          type="button"
          className="baud-phone-term-full-toggle"
          title={full ? "leave fullscreen - the layout underneath is unchanged" : "fill the screen with the room - nothing underneath moves, and the room stays attached"}
          onClick={() => setFull((on) => !on)}
        >
          {full ? "⤡" : "⤢"}
        </button>
        {/* ZOOM LIVES UNDER THE FULLSCREEN BUTTON now - Patrick's own placement
            ("it could go below the terminal expansion full screen button"): the
            right edge is the VIEW column, everything in the bottom row writes
            bytes. Moving them out is what bought the row its sticky chips. */}
        <div className="baud-phone-term-viewcol">
          {[1, -1].map((step) => (
            <button
              key={step}
              type="button"
              className="baud-phone-term-viewbtn"
              disabled={Boolean(refusal)}
              title={
                refusal ??
                (step < 0
                  ? `smaller type - buys columns, and the room is told (now ${font}px)`
                  : `bigger type - costs columns, and the room is told (now ${font}px)`)
              }
              onClick={() => zoom(step)}
            >
              {step < 0 ? "A−" : "A+"}
            </button>
          ))}
          {/* THE SELECT TOGGLE, PATRICK'S PLACEMENT: "can we move the sel?
              chip to inside the terminal under the A- and just a curser
              symbol". Third in the view column, so the stack reads
              fullscreen / bigger / smaller / select - and it belongs here for
              the same reason zoom does: nothing in this column writes a byte
              to the room, it changes how the room is VIEWED.
              The column is absolutely positioned over the screen, so gaining a
              button costs no terminal rows and moves nothing underneath - which
              matters more than usual this week, since a layout shift under a
              live drag is the resize that drops a selection.
              It OUTLIVED the probe it was built for (2026-08-16 ruling:
              the smoke-test strip goes, this stays) - selection is a ruled-in
              feature with its arc queued behind Patrick's gate. */}
          <button
            type="button"
            className={`baud-phone-term-viewbtn ${selecting ? "baud-phone-term-viewbtn-armed" : ""}`}
            disabled={Boolean(refusal)}
            aria-pressed={selecting}
            // Icon-only, so the button says its own name out loud - there is no
            // text for a screen reader to fall back on.
            aria-label={selecting ? "stop selecting text" : "select text by dragging"}
            title={
              refusal ??
              "select text by dragging - xterm selects locally instead of forwarding to tmux. While armed the room takes no taps."
            }
            onClick={() => {
              setSelecting((on) => {
                const next = !on;
                // Arming must not be able to summon a keyboard over the thing
                // being selected, and disarming leaves the room as it was.
                if (next) allowKeyboard(false);
                else {
                  drag.current.dragging = false;
                  term.current?.clearSelection();
                  setSelText("");
                  setCopyNote(null);
                }
                return next;
              });
            }}
          >
            {/* An I-beam, the text cursor every OS uses for "this is
                selectable": stem plus two serifs, same stroke idiom as the
                paperclip and the header icons. */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 4h6M9 20h6M12 4v16" />
            </svg>
          </button>
        </div>
      </div>

      {/* THE BELT: the key row and the compose bar, one strip, lifted above
          the soft keyboard by the visualViewport effect - see its comment. */}
      <div ref={belt} className="baud-phone-term-belt">
        {/* THE STRIP IS GONE; THE TWO DOORS IT CARRIED ARE NOT. Its readouts
            were instruments for one question - why a drag collapsed at 12-14
            characters - and that question is answered, so the amber dashed box
            went with the round that needed it. Copy and clear are not
            instruments: without them a selection is text a thumb can highlight
            and never use, which would delete the FEATURE while deleting the
            probe. Shown only while the sel chip is armed, because that is the
            only time either one means anything. */}
        {selecting ? (
          <div className="baud-phone-term-selrow">
            {/* The copy result is the operator's, not a diagnostic: the legacy
                execCommand lane can fail silently, so what it reports is the
                only way to know a tap did anything. */}
            {copyNote ? <p className="baud-phone-term-selnote">{copyNote}</p> : null}
            <div className="baud-phone-term-selrow-keys">
              <button
                type="button"
                className="baud-phone-term-key"
                disabled={!selText}
                title={selText ? `copy ${selText.length} characters` : "drag across the room to select first"}
                onClick={copySelection}
              >
                copy
              </button>
              <button
                type="button"
                className="baud-phone-term-key"
                disabled={!selText}
                title="drop the selection"
                onClick={() => {
                  term.current?.clearSelection();
                  setSelText("");
                  setCopyNote(null);
                }}
              >
                clear
              </button>
            </div>
          </div>
        ) : null}
        <nav className="baud-phone-term-keys">
          {/* The sel toggle used to open this row. It moved into the terminal's
              view column on Patrick's placement - see it there. The row is back
              to controls that WRITE BYTES, which is the line it was blurring. */}
          {CHIPS_LEFT.map((chip) => (
            <HoldButton
              key={chip.label}
              className="baud-phone-term-key"
              disabled={Boolean(refusal)}
              title={refusal ?? chip.title}
              onTap={() => pressChip(chip)}
              onHold={chip.hold ? () => press(chip.hold!.bytes) : undefined}
            >
              {chip.label}
            </HoldButton>
          ))}
          {(["ctrl", "alt"] as const).map((which) => {
            const state = which === "ctrl" ? ctrlMod : altMod;
            const set = which === "ctrl" ? setCtrlMod : setAltMod;
            return (
              <HoldButton
                key={which}
                className={`baud-phone-term-key baud-phone-term-sticky ${
                  state === "idle" ? "" : `baud-phone-term-sticky-${state}`
                }`}
                disabled={Boolean(refusal)}
                title={
                  refusal ??
                  `sticky ${which.toUpperCase()} - tap: arms for the NEXT key (letter or chip). HOLD: locks on until tapped off. Now: ${state}`
                }
                onTap={() => {
                  set((s) => (s === "idle" ? "latched" : "idle"));
                  // ARMING SUMMONS THE KEYBOARD (Patrick, first thumb test:
                  // "my keyboard would pop up so I can enter the next piece").
                  // A soft keyboard only exists while a field has focus, so
                  // the latch focuses the terminal - the tap is a user
                  // gesture, which is what lets focus() open the keys.
                  //
                  // ARMING A STICKY IS TYPING INTENT, stated rather than
                  // guessed at from a coordinate - so this lane opens the
                  // keyboard from anywhere in the room, and it is the answer
                  // for a room whose input is not at the bottom.
                  if (state === "idle") {
                    allowKeyboard(true);
                    term.current?.focus();
                  }
                }}
                onHold={() => {
                  set("locked");
                  allowKeyboard(true);
                  term.current?.focus();
                }}
              >
                {which}
              </HoldButton>
            );
          })}
          {CHIPS_RIGHT.map((chip) => (
            <HoldButton
              key={chip.label}
              className="baud-phone-term-key"
              disabled={Boolean(refusal)}
              title={refusal ?? chip.title}
              onTap={() => pressChip(chip)}
              onHold={chip.hold ? () => press(chip.hold!.bytes) : undefined}
            >
              {chip.label}
            </HoldButton>
          ))}
        </nav>

        <div className="baud-phone-term-input">
        {/* THE PICKER. `accept="image/*"` is the whole integration: Android
            offers the camera AND the gallery from this one input, with no
            native code and no permissions dance. `capture` is deliberately
            NOT set - it would force the camera and lock out the screenshot
            Patrick actually asked for. */}
        <input
          ref={picker}
          className="baud-phone-term-picker"
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void sendPhoto(file);
          }}
        />
        {/* A PAPERCLIP, NOT THE WORD. Patrick, dictating: "just do the paperclip
            thing. And then make it just fill that space... paperclip on the
            left, you have send on the right." The word cost the line most of a
            thumb's worth of width to say what one glyph says, and the compose
            field is the thing that wanted it - it already carries `flex: 1`, so
            every pixel this button gives up goes straight into the input.

            An SVG, not an emoji: the house idiom, the same 14px feather stroke
            as the header's bell and gear. Patrick's verdict on the emoji
            version of that question was "they are emotes uggggg".

            THE BEHAVIOUR IS UNTOUCHED - same picker, same disabled rule, same
            sentence. `sending` no longer swaps the glyph for an ellipsis,
            because an icon-only button that changes its contents changes its
            WIDTH, and the input beside it would twitch on every upload. The
            busy state is a class and the title; the box never moves. */}
        <button
          type="button"
          className={`baud-phone-term-photo ${sending ? "baud-phone-term-photo-busy" : ""}`}
          disabled={Boolean(refusal) || sending}
          title={
            refusal ??
            (sending
              ? "sending the photo…"
              : "attach a photo - its path is typed into your line, not sent")
          }
          aria-label="attach a photo"
          onClick={() => picker.current?.click()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        {/* A textarea, not an input: a long line WRAPS and the box grows, so
            what was typed ten words ago is still on screen (Patrick: "just
            like in any normal comment box"). One line tall until the content
            needs more; the growth cap lives in the CSS max-height. Enter
            still SENDS - unchanged from the input it replaced - so no
            KEYSTROKE can put a newline in the box. A PASTE could, which is
            what the onChange below is for. */}
        <textarea
          ref={compose}
          className="baud-phone-term-field"
          rows={1}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={refusal ? "read-only" : "type a line…"}
          disabled={Boolean(refusal)}
          title={refusal ?? "typed into the room, then submitted - two separate bytes"}
          value={text}
          // Newlines are flattened HERE, on the way in, not in send().
          //
          // The <input> this replaced could not hold one: HTML's value
          // sanitisation strips CR and LF from a text input, so a multi-line
          // paste arrived already flat. A textarea keeps every byte - and
          // send() writes the literal in one call, so an embedded \n is a
          // SUBMIT the operator never pressed: line one runs, then two, then
          // three. The comment on send() promises that a paste can never run
          // itself; after the element swap this is the line that keeps that
          // promise. Flatten to spaces rather than refuse, because that is
          // exactly what the input did and the text stays visible and
          // editable in the box either way.
          onChange={(event) => setText(event.target.value.replace(/[\r\n]+/g, " "))}
          onFocus={() => onComposeFocus?.(true)}
          onBlur={() => onComposeFocus?.(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Without this a textarea would insert the newline AND send.
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="baud-phone-term-send"
          disabled={Boolean(refusal) || !text}
          title={refusal ?? "type this line, then submit it"}
          onClick={send}
        >
          send
        </button>
        </div>
      </div>
    </section>
  );
}
