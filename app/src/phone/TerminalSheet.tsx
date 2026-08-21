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
import { type PhoneMode, launchCommand, typeOnAttach } from "./lib/rooms";
import { type Scope, scopeRefusal } from "./lib/verbs";

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

/**
 * What of `whole` the room has not been told yet, given what it has.
 *
 * One committed word can arrive through two doors - the events that build it
 * and the event that finishes it - and which door speaks first depends on the
 * browser. This is the whole of the de-duplication: a prefix already sent is
 * subtracted, a word already contained in what was sent is dropped outright,
 * and anything else is new and goes whole. Nothing here guesses; it compares.
 */
function unsaid(whole: string, said: string): string {
  if (!whole) return "";
  if (!said) return whole;
  if (whole.startsWith(said)) return whole.slice(said.length);
  return said.includes(whole) ? "" : whole;
}

/**
 * An editing intent, as the bytes a terminal expects - AND IT NEVER READS THE
 * FIELD (FPLAN-0446 round 6).
 *
 * Round 4 armed xterm's own textarea and let xterm deliver what landed in it.
 * That works everywhere a keyboard TYPES INTO a field. Gboard with prediction
 * on does not: it composes, and every one of xterm's delivery paths resolves
 * the composition by reading `textarea.value` back out - `_finalizeComposition`
 * takes `value.substring(start)` a tick after `compositionend`, and the
 * "any textarea changes" lane diffs the value against a copy. If the value
 * never took the word - and a preview drawn from the EVENT's data renders
 * identically whether it did or not - every one of those reads is empty and
 * the committed word goes nowhere. That is exactly what Patrick saw: the word
 * visible while composing, gone on space, zero bytes at the pty.
 *
 * So BAUD stops reading the field and reads the INTENT, which carries its own
 * payload: `data` on an insert, the inputType itself for a break or a delete.
 * `null` means "not an intent this bar has bytes for" - the caller leaves it
 * to the browser rather than inventing something, the same refusal
 * `modifiedChar` makes.
 */
function editBytes(event: InputEvent): string | null {
  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromComposition":
      return event.data ?? "";
    case "insertFromPaste":
      // Paste is the one intent whose payload is not on `data`.
      return event.dataTransfer?.getData("text/plain") ?? event.data ?? "";
    case "insertLineBreak":
    case "insertParagraph":
      // CR, not LF: a room's line discipline is what turns it into a newline.
      return "\r";
    case "deleteContentBackward":
      return "\x7f";
    case "deleteWordBackward":
      return "\x17";
    default:
      return null;
  }
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

/** Right of the stickies: panic button and submit. The arrows left this row -
 *  see CHIPS_ARROWS. */
const CHIPS_RIGHT: ReadonlyArray<ChipSpec> = [
  // Pre-baked despite sticky CTRL: interrupt is the panic button, and a
  // two-tap race against a runaway process is the wrong shape for one.
  { bytes: "\x03", label: "^C", title: "interrupt - the byte Ctrl+C sends" },
  {
    bytes: "\r",
    label: "⏎",
    title: "submit the line. HOLD: newline WITHOUT submitting (Ctrl+J - the one both TUIs honor)",
    hold: { bytes: "\n", title: "newline, no submit" },
  },
];

/**
 * THE ARROWS, AND THEY LIVE IN THE TERMINAL'S VIEW COLUMN NOW - Patrick's
 * placement 2026-08-20: *"remove the arrows and place them in the terminal
 * chips just underneath the copy one... they're so small, I have a pretty hard
 * time pressing those buttons"*.
 *
 * THE ERGONOMIC TRADE, stated because it is the whole point: the belt was
 * ELEVEN chips across a phone, so every one of them was thumb-width at best
 * and the arrows - the chips pressed most, one tap per menu row - were the
 * ones that hurt. Moving four out leaves seven, which widens every chip that
 * stayed AND buys the arrows a 31px square each in the view column. One edit,
 * both halves better.
 *
 * IT BREAKS THE VIEW COLUMN'S OLD INVARIANT and that is deliberate, not an
 * oversight. That column's rule was "nothing in here writes a byte to the
 * room, it changes how the room is VIEWED" - arrows write bytes. The rule was
 * a description of what happened to be there, not a promise to the operator;
 * what the operator actually reads off that column is "controls that are not
 * the keyboard row", and arrows belong to that far more than they belonged to
 * a row they were crushing. What the column may NOT become is the keyboard
 * row's overflow bin - if a fifth thing wants in, that is the round to re-ask.
 *
 * ORDER IS ↑ ↓ ← → rather than the belt's ← ↓ ↑ →: in a VERTICAL stack the
 * pair that must be adjacent is up/down, because that is the pair that walks a
 * menu and a history, and a thumb finds it by feel between them. Left/right
 * are the rare pair here (line editing happens in the compose box, not the
 * room) so they take the bottom.
 */
const CHIPS_ARROWS: ReadonlyArray<ChipSpec> = [
  { bytes: "\x1b[A", label: "↑", title: "Up arrow - menus, history. Does NOT scroll.", arrow: "A" },
  { bytes: "\x1b[B", label: "↓", title: "Down arrow - menus, history. Does NOT scroll.", arrow: "B" },
  { bytes: "\x1b[D", label: "←", title: "Left arrow (latched CTRL/ALT modify it)", arrow: "D" },
  { bytes: "\x1b[C", label: "→", title: "Right arrow (latched CTRL/ALT modify it)", arrow: "C" },
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
 * THE DEFAULT IS THE FLOOR NOW - Patrick 2026-08-20: *"zoom terminal default
 * setting, I'd like to test full zoom out as default"*. Written as `MIN_FONT`
 * rather than as the number 7, because the ruling is "start fully zoomed out",
 * not "start at seven" - if the floor ever moves, the default is supposed to
 * move with it.
 *
 * IT OVERRULES WHAT STOOD HERE, and the old reasoning is kept because it may
 * yet be right: 11 came down to 10 on an earlier "smaller" from him, and the
 * comment then claimed 10 was the smallest size that still reads as text
 * rather than texture on a 420px-wide phone - below it, the argument went, the
 * operator squints at a room they cannot act on, buying rows at the cost of
 * what the rows are for. That was a judgement about legibility made by the
 * person doing the reading, and the same person has now asked to go past it
 * twice. His eyes, his call - and this is explicitly a TEST, so the number is
 * expected to come back up if it reads as texture in practice.
 *
 * Nothing is trapped either way: the zoom chips still travel the full range
 * from here, so a session that wants bigger type is one tap from it.
 *
 * ZOOMING OUT BUYS REAL COLUMNS. That is only true because the resize lane
 * works: fewer pixels per cell means more cells, FitAddon measures them, and
 * the room follows because it is opened `window-size smallest`. Before that fix
 * this control would have been a lie told to a deaf room.
 */
/**
 * `COMMENT_ROWS` STOOD HERE, and its absence is the round.
 *
 * It answered "how many rows at the bottom count as the place you type" - a
 * heuristic with a number, five, because a terminal is a character grid and
 * nothing in it announces where a TUI's input box is. It was honest work for
 * the question it was asked. Round 3 retired the QUESTION: no tap opens a
 * keyboard into the room at all now, so there is no bottom region to
 * recognise and no number to tune. See the touchstart handler for why.
 */

/**
 * How long the submit byte will wait for the line to APPEAR before going
 * anyway (FPLAN-0446 round 2b).
 *
 * Round 2 sent the line and its CR as two frames and let the far end sort out
 * the order. It did not: the CR was acted on before the paste it followed had
 * been committed, so a stale line submitted and the fresh text landed in the
 * emptied box behind it. A bigger sleep would only have moved those odds - the
 * commit is on the far end's clock, not this one, and nothing here can measure
 * it. So the CR waits for PROOF instead: this face already renders every byte
 * the room emits, so it can watch for the line to show up in the room's own
 * buffer and submit the moment it does.
 *
 * The ceiling exists because proof is not guaranteed - a program that echoes
 * nothing, or renders a placeholder instead of the text, would otherwise
 * strand the line forever. Reaching it means falling back to exactly the
 * behaviour round 2 shipped, which is the floor of this design rather than its
 * intent, and it is generous enough that a slow room is not cut off.
 */
const SUBMIT_CEILING_MS = 600;

/** How often to look. One frame: cheaper than it sounds, and it reads local. */
const SUBMIT_LOOK_MS = 16;

/**
 * The shortest landmark worth trusting. Two characters of "ok" would match
 * half the transcript; below this the handshake is weaker than no handshake,
 * so it is skipped and the ceiling carries the send.
 */
const LANDMARK_MIN = 4;

/** And the longest - a tail is enough, and it bounds the scan. */
const LANDMARK_MAX = 32;

/** A blur this soon after arming is the focus dance, not a dismissal. */
const BLUR_GRACE_MS = 500;

/**
 * How long the box must hold still before its size is believed.
 *
 * A soft keyboard does not open in one step. It used to animate the LAYOUT
 * viewport shut - phone.html asked for `interactive-widget=resizes-content`
 * until r8 - and every frame of that animation was a ResizeObserver callback:
 * a `fit()` and a resize frame per frame, a pty re-flowing a dozen times while
 * the keys slid up, which is the frame collision benched as the mechanism
 * behind the garbled lines. Waiting for the box to settle asks the pty once,
 * for the size it actually ended at.
 *
 * With the token gone the keyboard no longer resizes this box AT ALL, so that
 * particular storm cannot happen. The debounce stays because it was never only
 * about the keyboard: a rotation, a pane opening or closing, and the belt
 * changing height all move this box, and the pty should hear the size it came
 * to rest at rather than every frame on the way there.
 */
const FIT_DEBOUNCE_MS = 120;

/* ---------------------------------------------------------------- liveness --
 * THE PHONE HAD NONE, AND THAT IS WHY IT PAINTED A CORPSE (FPLAN-0446 r5).
 *
 * The other end has liveness and uses it: uvicorn pings every 20s and hangs up
 * on a pong that does not come back inside 20s (measured off Config's own
 * signature, 2026-08-19). A browser has no ping API at all - the protocol's own
 * ping/pong is answered down in the network stack, below JavaScript, and never
 * surfaces here - so the room can be torn down on a clock this side does not
 * share, and this side goes on rendering the last frame it was handed. A dead
 * room and a quiet room look EXACTLY the same, which is what cost Patrick an
 * evening of typing into nothing.
 *
 * Two lanes, and the phone FEATURE-DETECTS which one it is in rather than
 * coupling to a server version:
 *
 *  - THE REAL ROUND TRIP, when the control channel answers. One probe
 *    `{type:"ping"}` per socket; a `{type:"pong"}` back means this host has the
 *    lane, and from then on liveness is MEASURED instead of guessed. Exactly
 *    one probe, never a retry loop: a host without the lane writes a warning
 *    line for every unknown control frame it is sent (`_handle_control`,
 *    @api's `server.py:580` - read before this was built, which is also how it
 *    is known that an unknown frame is IGNORED and never fatal), and a
 *    keepalive that fills somebody else's log is a bug wearing a fix's coat.
 *
 *  - THE SILENCE GUESS, when it does not answer. That is the lane Patrick is
 *    actually on tonight: @api's ping/pong is dispatched but not live on prod,
 *    and it is not this face's business to know when it lands - a pong turns
 *    the better lane on by itself, on whichever socket first gets one back.
 */

/**
 * How long a room may say NOTHING before the phone stops believing it.
 *
 * NINETY SECONDS, AND THE NUMBER IS MEASURED, not felt. An idle agent room is
 * not actually silent - tmux redraws its status bar - but it only emits when
 * that bar's TEXT changes, so the gaps are long and uneven: benched on a live
 * idle room, the longest gap between bytes was 29 SECONDS inside a 62-second
 * window. A watchdog at 15s would therefore execute a perfectly healthy room
 * about once a minute, and every one of those kills costs the desk a full
 * repaint (`window-size smallest`, 5392 bytes benched for one column). Three
 * times the worst measured gap is the margin. The cost of being wrong in this
 * direction is one reattach; the cost of being wrong in the other is the
 * corpse frame, and those two are not the same size.
 */
const SILENCE_MS = 90_000;

/** How often the watchdog looks - WHILE VISIBLE ONLY. Nothing runs in a pocket. */
const LIVENESS_TICK_MS = 10_000;

/** With the control channel answering, a round trip is overdue after this long.
 *  Three ticks' worth, so one lost tick is never on its own a verdict. */
const PONG_DEAD_MS = 30_000;

/**
 * The reconnect ladder, in milliseconds, indexed by consecutive failures.
 *
 * The first rung is IMMEDIATE - a socket that died in front of somebody who is
 * looking at it gets its retry now - and the rungs after it back off hard,
 * because a room that refused twice will refuse the third time too and each
 * attach costs the desk a repaint. @api's log caught 13 attaches in three
 * minutes on the night this was written; this ladder makes that shape
 * impossible without ever making the first recovery slow.
 */
const RECONNECT_MS = [0, 1_000, 3_000, 6_000, 12_000, 30_000];

/** How many tries in a row before the phone stops and SAYS it stopped. A room
 *  that is gone is not reachable by repetition, and the door never closes: the
 *  overlay's button is always live, and looking away and back resets the count. */
const RECONNECT_TRIES = RECONNECT_MS.length;

/** A handshake already in flight is not a reason to start a second one - so the
 *  lane looks again after this instead of counting a try. */
const HANDSHAKE_POLL_MS = 1_000;

const MIN_FONT = 7;
const MAX_FONT = 18;
/** Fully zoomed out on open - see the block above. Declared AFTER MIN_FONT
 *  because these are module-level consts: reading MIN_FONT before its own
 *  declaration is a TDZ ReferenceError at import time, not a hoisted zero. */
const DEFAULT_FONT = MIN_FONT;

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
   * Consecutive attempts that never reached `onopen`. A REF, not state: the
   * reconnect lane reads it to pick its rung and the attach effect resets it
   * on a successful open, and neither of those is a reason to re-render - but
   * putting it in the attach effect's dependencies WOULD be a reason to
   * reattach, which is the exact churn this counter exists to bound.
   */
  const retries = useRef(0);
  /** Is a retry armed right now? Rendered, because "reconnecting" and "gave up"
   *  are different situations for the person holding the phone and a spinner
   *  that means both is a lie in either direction. */
  const [reconnecting, setReconnecting] = useState(false);
  /**
   * Has this sheet EVER been attached? Three states hide behind `!live` and
   * they do not deserve the same sentence: opening for the first time (no
   * frame has ever arrived, so there is no corpse to warn about), attached and
   * then dropped (there is one, and it is the whole problem), and never got in
   * at all. Without this the overlay flashes "detached - this is the last
   * frame you were sent" over an empty grid during every normal open, which
   * would be the same species of lie in the opposite direction.
   */
  const [opened, setOpened] = useState(false);
  /**
   * A retry the OPERATOR asked for: the ladder starts again from its first
   * rung, because a thumb on the button is new information about whether the
   * room is worth trying. Every hand-driven reattach goes through here, so the
   * button and the photo lane can never drift apart on that rule.
   */
  const reattachNow = useCallback(() => {
    retries.current = 0;
    setAttempt((n) => n + 1);
  }, []);
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
   * THE CHIP ROW'S OWN FIELD - the only door a soft keyboard has into this
   * sheet (FPLAN-0446 round 3, @devpulse's ruling).
   *
   * Arming ctrl or alt is TYPING INTENT, stated out loud, and it needs a
   * keyboard to be worth anything: "ctrl then a letter" has a letter in it.
   * That affordance used to open the IME against xterm's own helper textarea,
   * which put composed characters one step from the pty - the exact lane that
   * turns `/clear` into `/prep`.
   *
   * So the affordance stays and the TARGET moves. The keyboard opens against
   * this field instead, which belongs to the chip row and never to the room.
   * BAUD reads what lands in it, translates it, and writes bytes - so what
   * crosses to the pty is a byte this file chose, never whatever an autocorrect
   * decided a moment later. Composition cannot reach the room raw because
   * composition never touches anything the room can see.
   */
  const proxy = useRef<HTMLInputElement | null>(null);

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
   * without a keyboard or a paste menu.
   *
   * ROUND 3 MADE THE ANSWER PERMANENT. Every caller now passes `false`: no tap
   * and no chip opens a keyboard into the room, so that cost is no longer a
   * cost with a way back - it is the shape of the thing. The parameter stays
   * because what this function DOES is still "decide", and a room that one day
   * needs a live-keystroke mode (round 4, option ii) turns it back on here, in
   * one place, rather than by rebuilding the mechanism.
   */
  /** xterm's own hidden textarea: the room's real keyboard surface, and since
   *  this round the ONLY one typing goes through. */
  const helperField = useCallback(
    () => host.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea") ?? null,
    [],
  );

  const allowKeyboard = useCallback((allowed: boolean) => {
    const field = helperField();
    if (!field) return;
    field.readOnly = !allowed;
    field.inputMode = allowed ? "text" : "none";
  }, [helperField]);

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

  /**
   * TYPING MODE (FPLAN-0446 round 4, door C - Patrick's ruling of 19:13 after
   * testing all three doors on the probe: *"type a and b actually cover the
   * typing by a bit. type c is only one that works."* A and B put their door
   * ON the line he was typing; the bar does not.)
   *
   * Round 3 made the room a view and that closed the mis-aim trap. It also
   * muted every room BAUD has - *"I cant type in any termi al now"* - because
   * the trap and the capability came through the same door. This is the door
   * back, and the difference from the one that was closed is that it is
   * ARMED DELIBERATELY, on a fixed target, and BAUD translates instead of
   * letting composition reach the pty.
   */
  const [typing, setTyping] = useState(false);
  /** The live answer for the native handlers, which must not close over a
   *  stale render. */
  const typingOn = useRef(false);
  useEffect(() => {
    typingOn.current = typing;
  }, [typing]);
  /** When arming happened. Declared up here, beside the flag it belongs to,
   *  because the attach effect below now reads it too. */
  const armedAt = useRef(0);

  /**
   * THE COMPOSITION IN FLIGHT - what BAUD has already told the room about it,
   * so the commit at the end cannot say it twice.
   *
   * A predictive keyboard announces one word through two doors: the events
   * that build it, and `compositionend` carrying the finished thing. Which
   * door delivers depends on the browser and on whether the commit arrives
   * before or after the key that caused it, so the lane below listens at both
   * and this ref is how the second one knows what the first already sent.
   * `start` is the fallback's anchor: on a browser whose `compositionend`
   * carries no data, the field is read from where the composition began -
   * xterm's own algorithm, kept as the belt to the event-data braces.
   *
   * `text` is the third source, and it is not decoration: MEASURED in Chrome
   * over CDP, a space delivered as a KEY while a composition is open commits
   * the word with NO `compositionend` event at all - the only trace of it left
   * anywhere is the last `compositionupdate`. Without this the word is lost on
   * exactly the keystroke Patrick reported it lost on.
   */
  const composing = useRef({ on: false, text: "", sent: "", start: 0 });

  /** Open the chip row's field, which is what summons the keyboard. */
  const openProxy = useCallback(() => {
    const field = proxy.current;
    if (!field) return;
    field.value = "";
    field.focus();
  }, []);

  /** And shut it, which is what puts the keyboard away. */
  const closeProxy = useCallback(() => {
    const field = proxy.current;
    if (!field) return;
    field.value = "";
    field.blur();
  }, []);

  const captureOne = useCallback(
    (event: InputEvent) => {
      const field = proxy.current;
      if (!field) return;
      const { ctrl, alt } = mods.current;
      const ctrlOn = ctrl !== "idle";
      const altOn = alt !== "idle";

      // Nothing is ever COMMITTED to this field - it exists to be read, not to
      // hold text - so every path below clears it.
      event.preventDefault();
      const typed = event.data ?? "";
      field.value = "";
      if (event.isComposing || typed.length !== 1) return;
      if (!ctrlOn && !altOn) {
        // Both modifiers were dropped while the keyboard was up. A bare letter
        // is not this door's business - the room is a view - so it goes
        // nowhere and the door shuts.
        closeProxy();
        return;
      }
      const bytes = modifiedChar(typed, ctrlOn, altOn);
      if (bytes === null) return; // no byte exists for it; keep the latch armed
      write(bytes);
      consumeLatch();
      if (ctrl !== "locked" && alt !== "locked") closeProxy();
    },
    [closeProxy, consumeLatch, write],
  );

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
    // WHILE THE BAR IS ARMED, BAUD OWNS THE KEYBOARD AND XTERM OWNS THE VIEW.
    // Every one of xterm's key paths resolves a soft-keyboard keystroke by
    // reading the textarea back out - the composition finalizer and the
    // value-diff lane both - so with the lane below sending from the events
    // themselves, those paths can only repeat a keystroke or send an empty
    // one. Returning false here is the whole cut: composition events are not
    // key events, so the preview xterm paints is untouched.
    //
    // DISARMED, NOTHING CHANGES: `true` is xterm's normal behaviour, which is
    // what a room with no keyboard pointed at it has always had.
    xterm.attachCustomKeyEventHandler(() => !typingOn.current);
    // ...and the BAR goes down with it. A reattach re-fences the field, so a
    // bar still claiming to be armed would point at a lane that refuses - the
    // same lying bar this round is closing, one layer further down.
    typingOn.current = false;
    setTyping(false);

    // AN ARMED BAR WITH NO KEYBOARD BEHIND IT IS A LIE about where the next
    // keystroke goes, and this round exists because of that class of lie. The
    // back gesture, a swipe, or the OS reclaiming focus all arrive here as a
    // blur, so the bar follows the keyboard down.
    //
    // The grace window is not decoration: arming focuses this field, and focus
    // can settle through an intermediate blur. Disarming on that would switch
    // the bar off the instant it came on - a dead feature wearing a live one's
    // clothes, which is how door C looked from the outside.
    const onHelperBlur = () => {
      if (!typingOn.current) return;
      if (Date.now() - armedAt.current < BLUR_GRACE_MS) return;
      typingOn.current = false;
      setTyping(false);
      allowKeyboard(false);
    };
    const helper = helperField();
    helper?.addEventListener("blur", onHelperBlur);

    /** One typed thing, on its way to the room. User input scrolls the view
     *  the way a chip does - `scrollOnUserInput` cannot, because nothing
     *  reaches xterm's own input path while the bar is armed. */
    const toRoom = (text: string) => {
      if (!text) return;
      if (composing.current.on) composing.current.sent += text;
      xterm.scrollToBottom();
      if (!write(throughMods(text))) setError(DETACHED);
    };

    const onCompositionStart = () => {
      composing.current = { on: true, text: "", sent: "", start: helper?.value.length ?? 0 };
    };

    /** The word as it stands. xterm paints its preview from this same data -
     *  reading it costs nothing and is the only record of a composition that
     *  a key commits without ever ending. */
    const onCompositionUpdate = (event: CompositionEvent) => {
      composing.current.text = event.data ?? "";
    };

    /**
     * THE COMMITTED WORD, taken from the event rather than the field.
     *
     * `compositionend.data` IS the committed string - it is the one place the
     * word exists that does not depend on the textarea having accepted it.
     * xterm distrusts it for CJK, where the final character can differ from
     * what was composed, and reads the field instead; that trade is the right
     * one for a desktop IME and the wrong one for Gboard, whose prediction
     * commits Latin words the field never sees. Data first, field second: if
     * a browser sends no data, the field is read from the composition's own
     * start, which is xterm's algorithm run by BAUD.
     */
    const onCompositionEnd = (event: CompositionEvent) => {
      const { on, text, sent, start } = composing.current;
      composing.current = { on: false, text: "", sent: "", start: 0 };
      const held = helper?.value ?? "";
      // THE FIELD IS EMPTIED ON EVERY COMMIT, armed or not. It is a keyboard
      // surface, never a document, and leaving text in it is what lets xterm's
      // delayed read send this same word a second time a tick from now. It
      // also stops the value growing without bound across a session.
      if (helper) helper.value = "";
      if (!typingOn.current || !on) return;
      // Event data first, the field second, the last update third: three
      // sources for one word, in order of how much each depends on something
      // outside the event itself.
      toRoom(unsaid(event.data || held.slice(start) || text, sent));
    };

    /**
     * EVERYTHING THAT IS NOT A COMPOSITION: the space that commits a word, the
     * digits and punctuation prediction never composes, Enter, backspace, a
     * paste. xterm's own input handler drops these on Android - it requires
     * `!composed || !keyDownSeen`, and a Gboard insert is composed while a
     * keydown is still open, so both halves are false.
     *
     * Composing events are left ALONE and that is deliberate: they are what
     * xterm paints the in-terminal preview from, and the preview is the half
     * that already works.
     */
    const onHelperInput = (event: InputEvent) => {
      if (!typingOn.current || event.isComposing) return;
      const bytes = editBytes(event);
      if (bytes === null) return;
      // A NON-COMPOSING EDIT WHILE A COMPOSITION IS OPEN IS THE COMMIT.
      // MEASURED, not assumed: a space dispatched as a key over CDP commits
      // the word and fires no `compositionend` at all, so this insert is the
      // only announcement the word will ever get. It goes out FIRST, in the
      // order it was typed, and `on` stays true so a late `compositionend`
      // still de-duplicates against what just went.
      if (composing.current.on) toRoom(unsaid(composing.current.text, composing.current.sent));
      // Refusing the edit keeps the field empty, which is both the hygiene
      // above and the guarantee that xterm's value-reading paths have nothing
      // to deliver behind BAUD's back.
      event.preventDefault();
      if (helper) helper.value = "";
      toRoom(bytes);
    };

    const onBeforeInput = (event: Event) => onHelperInput(event as InputEvent);
    helper?.addEventListener("compositionstart", onCompositionStart);
    helper?.addEventListener("compositionupdate", onCompositionUpdate);
    helper?.addEventListener("compositionend", onCompositionEnd);
    helper?.addEventListener("beforeinput", onBeforeInput);

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

    /* ---------------------------------------------------------- liveness --
     * All of this is per-SOCKET, so it lives in the socket's own scope as
     * plain locals rather than as refs: a new attach gets a new clock, and
     * there is no way for the previous socket's last-heard-from to survive
     * into the next one and answer for it.
     */
    /** When ANYTHING last arrived on this socket. Any frame is proof of life. */
    let lastRx = Date.now();
    /** When the last pong came back, and whether this host answers pings. */
    let lastPong = 0;
    let pongLane = false;
    /** Set when the watchdog is the one closing, so the close can say why. */
    let silenced = false;
    let watchdog = 0;

    /** The probe, and later the keepalive. Text frame: @api's split is text =
     *  control, binary = keystrokes, so this can never be typed into the room. */
    const ping = () => {
      if (live.readyState !== WebSocket.OPEN) return;
      live.send(JSON.stringify({ type: "ping" }));
    };

    const tick = () => {
      if (live.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (pongLane) {
        // MEASURED, not guessed: this host answers, so an unanswered round
        // trip is the verdict and 90 seconds of quiet is not needed.
        if (now - lastPong > PONG_DEAD_MS) {
          silenced = true;
          live.close();
          return;
        }
        ping();
        return;
      }
      if (now - lastRx > SILENCE_MS) {
        silenced = true;
        live.close();
      }
    };

    /** The watchdog runs WHILE VISIBLE and at no other time. A socket that dies
     *  in a pocket is found on the next look, not by a timer nobody is reading -
     *  same rule as `whileVisible`, and the same reason. */
    const watch = (on: boolean) => {
      window.clearInterval(watchdog);
      watchdog = 0;
      if (on) watchdog = window.setInterval(tick, LIVENESS_TICK_MS);
    };

    live.onopen = () => {
      setLive(true);
      setOpened(true);
      // This socket reached open, so the ladder starts from the bottom again.
      retries.current = 0;
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
      // THE PROBE, second frame and once per socket. If this host answers, the
      // watchdog stops guessing from silence and starts measuring round trips;
      // if it does not, this is the only ping it will ever be sent and the
      // fallback carries the room. Either way nothing here waits on the answer.
      ping();
      lastRx = Date.now();
      if (document.visibilityState === "visible") watch(true);
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
      // ANY frame is proof of life, whatever it carries and whether or not it
      // is understood. This is the one line the whole silence watchdog rests
      // on, so it runs FIRST and unconditionally.
      lastRx = Date.now();
      // Terminal data is binary in both directions. Anything else on this
      // socket is not room output and is not painted as if it were.
      if (event.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(event.data));
        return;
      }
      // Text is CONTROL - @api's own split, read from the other side of the
      // wire. The only question this client asks is the ping, so the only
      // answer it looks for is the pong; anything else a future host says here
      // is ignored quietly rather than treated as an error, because a client
      // that breaks on an unrecognised control frame is a client that cannot
      // be extended past.
      if (typeof event.data !== "string") return;
      let control: unknown;
      try {
        control = JSON.parse(event.data);
      } catch {
        return;
      }
      if (control && typeof control === "object" && (control as { type?: unknown }).type === "pong") {
        lastPong = Date.now();
        // FEATURE-DETECTED, never assumed, and it latches: one pong is proof
        // this host has the lane, and it stays proof for the life of the
        // socket. No version number is asked for or believed.
        pongLane = true;
      }
    };

    live.onerror = () => {
      // A browser surfaces no code here. The one thing that refuses BEFORE the
      // socket is established is auth, so this sentence can be specific.
      setError("the room refused this connection - the token was rejected, or the host is unreachable");
    };

    live.onclose = (event) => {
      socket.current = null;
      watch(false);
      setLive(false);
      setStatus(
        silenced
          ? // NAMED, because this one is the phone's own doing and an operator
            // owed the truth about a dead room is owed it about the kill too.
            pongLane
            ? "the room stopped answering - let go of the socket"
            : "no bytes from the room for 90s - let go of the socket"
          : "detached - the room and whatever runs in it are still there",
      );
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
      // THE ROOM IS A VIEW. NO TAP OPENS A KEYBOARD INTO IT (FPLAN-0446
      // round 3, contract C).
      //
      // This line used to read `allowKeyboard(at.row > rows - COMMENT_ROWS)`:
      // a tap in the bottom five rows armed the IME so the operator could type
      // into Claude Code's own compose box. That door was built on purpose and
      // it became the trap. Patrick aims for the baud box, catches the room
      // instead, and types BLIND into a box he cannot see - and mobile IME
      // into a terminal is unwinnable by construction: composition and
      // autocorrect mean the characters that arrive are not the characters he
      // typed. He reproduced the ceiling of that on demand: /help in the CC
      // box drove the slash menu to `prep`, the same way /clear once did,
      // because his composed characters never reach it as keystrokes, the
      // menu never filters, and Enter takes whatever is highlighted. The
      // wrong command runs.
      //
      // So the door closes, and the mis-aim trap dies STRUCTURALLY rather than
      // by being made more accurate: with no focus there is no blind typing to
      // recover from. Everything focus is load-bearing for is untouched - the
      // tap still reaches tmux as a click, xterm still runs its own word
      // selection, and the timing that made this work is unchanged. Only the
      // ANSWER is now always no.
      //
      // The stated-intent door survives elsewhere: arming a sticky opens the
      // keyboard against the chip row's own field, where BAUD translates what
      // it catches instead of letting composition reach the pty raw.
      // ...unless the operator SAID otherwise. The bar is a stated intent and
      // a tap inside the room is not a retraction of it - re-fencing here would
      // disarm typing mode the first time he touched the thing he is typing
      // into. Disarmed, this is exactly the round-3 refusal it always was.
      if (event.touches.length === 1 && !typingOn.current) allowKeyboard(false);
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
      // An empty string is not a keystroke. xterm's composition finalizer can
      // fire one - it sends `value.substring(start, end)` unguarded when a key
      // ends a composition - and forwarding it would put an empty frame on the
      // wire for a word that was never typed.
      if (!bytes) return;
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
      if (document.visibilityState !== "visible") {
        // NOTHING RUNS IN A POCKET, the watchdog least of all: a timer that
        // executed sockets while nobody was looking would be manufacturing the
        // very churn this round is cutting.
        watch(false);
        return;
      }
      const open = socket.current;
      // THE RECONNECT LANE OWNS THIS NOW. Until r5 this line bumped `attempt`
      // itself, which made the foreground edge a second, independent source of
      // attaches - it could fire while a handshake was already in flight and
      // throw away a socket that was seconds from opening. One lane decides
      // when a socket opens (the effect below), and it is watching this same
      // event; here the only job left is to stop pretending an unopen socket
      // is worth resizing.
      if (!open || open.readyState !== WebSocket.OPEN) return;
      // A FRESH LOOK STARTS A FRESH MEASUREMENT. The clock is about how long
      // the ROOM has been quiet while somebody was watching it, and a phone in
      // a pocket was not watching - carrying that dead time forward would
      // execute a healthy room on the first tick after every pocket.
      lastRx = Date.now();
      if (pongLane) {
        lastPong = Date.now();
        ping();
      }
      watch(true);
      // THE SIZE IS RE-STATED ON EVERY RETURN, not only at open.
      //
      // Until this line the phone declared its geometry exactly twice: once in
      // `onopen`, and again whenever its OWN box changed and the observer below
      // fired. That is a one-shot declaration wearing a listener's clothes -
      // every way the pty moves from the HOST side leaves the phone's box
      // untouched, so nothing fires, and the phone goes on rendering a window
      // it no longer fits. The room drifts wider and taller than the client;
      // the client clips it.
      //
      // Patrick reported the shape of exactly that: the right edge chopped and
      // the agent rows gone, WITH the tmux status bar still sitting at the
      // bottom. Those two are not in conflict once the pty is BIGGER than the
      // client - the room draws its bar as the last line of the stream, so the
      // bar is the one thing that survives; what is lost is the body above it,
      // and the columns past the client's width. The bar being visible is
      // evidence FOR the mismatch, not against it.
      //
      // So the phone re-states what it already knows the moment he looks at it.
      // Same idiom as `whileVisible` and for the same reason: no clock, no
      // poll, nothing runs in a pocket - the wheel is read when it is read. A
      // resize to the size it already is costs one small frame and is a no-op
      // at the pty, which is the point: it is safe to say always, so it can be
      // said unconditionally rather than guessed at.
      try {
        fit.fit();
      } catch {
        // Sheet closing, element gone. Not a failure - same rule as below.
        return;
      }
      sendResize();
    };
    document.addEventListener("visibilitychange", onVisible);

    /** The fit the observer owes, once the box stops moving. */
    let settle = 0;
    const fitAndTell = () => {
      try {
        fit.fit();
      } catch {
        // The sheet is closing and the element is gone. Not a failure.
        return;
      }
      sendResize();
    };
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
      // TRAILING, never leading: the size worth declaring is the one the box
      // came to rest at, and a leading call would declare the first frame of
      // the keyboard animation as if it were the answer.
      window.clearTimeout(settle);
      settle = window.setTimeout(fitAndTell, FIT_DEBOUNCE_MS);
    });
    observer.observe(host.current);

    return () => {
      screen.removeEventListener("touchstart", onTouchStart);
      screen.removeEventListener("touchmove", onTouchMove);
      screen.removeEventListener("touchend", onTouchEnd);
      screen.removeEventListener("touchcancel", onTouchCancel);
      screen.removeEventListener("click", swallowClick, true);
      screen.removeEventListener("contextmenu", onContextMenu);
      helper?.removeEventListener("blur", onHelperBlur);
      helper?.removeEventListener("compositionstart", onCompositionStart);
      helper?.removeEventListener("compositionupdate", onCompositionUpdate);
      helper?.removeEventListener("compositionend", onCompositionEnd);
      helper?.removeEventListener("beforeinput", onBeforeInput);
      // A fit owed to a sheet that is closing is not owed at all - the element
      // it would measure is on its way out.
      window.clearTimeout(settle);
      watch(false);
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
  }, [attachedTo, mode, opener, refusal, write, attempt, throughMods, allowKeyboard, helperField]);

  /**
   * THE RECONNECT LANE - one place, and the only place, that decides when a
   * socket opens (FPLAN-0446 r5).
   *
   * Before this, coming back into view was the ONLY way a dead room came back:
   * a socket that died while Patrick was looking straight at it stayed dead
   * until he backgrounded the app and returned. That is the wrong shape twice
   * over - it makes recovery depend on a gesture that has nothing to do with
   * the failure, and it means the longer he sits watching a room the further
   * he is from it working.
   *
   * So the ladder runs WHILE VISIBLE, and it is a ladder rather than a poll
   * for a measured reason: the room is opened `window-size smallest`, so every
   * attach drags the desk's window down to the phone's columns and pays for a
   * full repaint on the other end (5392 bytes for a one-column change, benched
   * 2026-08-19). Retrying is not free and is not owed to anyone at a fixed
   * rate. First rung immediate, then 1s, 3s, 6s, 12s, 30s, then it STOPS and
   * says it stopped - because a room that has refused six times running is
   * gone, not slow, and the honest answer to gone is a button rather than an
   * ever-turning wheel.
   *
   * Hidden means idle: no timer survives into a pocket, and coming back into
   * view resets the count, because a fresh look is a fresh chance.
   *
   * ONE THING THIS DELIBERATELY DOES NOT DO, said out loud rather than left to
   * be discovered: it does not ask whether this sheet's TAB is the one on
   * screen. Every open pane stays mounted and stays attached on purpose - a
   * room drops its client only on the operator's own gestures - so a
   * background pane recovering its room is the doctrine working, and the
   * alternative is switching to a tab and finding a corpse there instead. The
   * bill is bounded by the ladder: N dead panes cost at most N x 6 attaches
   * per look, not a flap per pane forever.
   */
  useEffect(() => {
    // Attached, or never going to be - either way there is nothing to retry.
    // A read token gets no socket at all (the refusal is the answer), and
    // retrying an auth refusal would be asking the same question louder.
    if (live || refusal) {
      setReconnecting(false);
      return;
    }
    let timer = 0;
    const armIn = (wait: number) => {
      window.clearTimeout(timer);
      setReconnecting(true);
      timer = window.setTimeout(() => {
        const open = socket.current;
        // A HANDSHAKE IN FLIGHT IS NOT A REASON TO START A SECOND ONE. This is
        // the cheapest of this round's four cuts and the one that mattered
        // most on the wire: opening over a CONNECTING socket abandons a
        // connection that was about to work and bills the desk for both.
        if (open && open.readyState === WebSocket.CONNECTING) {
          armIn(HANDSHAKE_POLL_MS);
          return;
        }
        // AND IT CAME BACK WHILE THE RUNG WAS TICKING. `live` is React state,
        // so between the socket opening and this component re-rendering there
        // is a window where the effect has not been torn down yet - reading
        // the socket itself closes it. Without this the very first rung after
        // a slow open would tear down a working room.
        if (open && open.readyState === WebSocket.OPEN) {
          setReconnecting(false);
          return;
        }
        retries.current += 1;
        setAttempt((n) => n + 1);
      }, wait);
    };
    const arm = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible" || retries.current >= RECONNECT_TRIES) {
        setReconnecting(false);
        return;
      }
      armIn(RECONNECT_MS[Math.min(retries.current, RECONNECT_MS.length - 1)]);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(timer);
        setReconnecting(false);
        return;
      }
      // A FRESH LOOK IS A FRESH CHANCE. Whatever was true of the host a minute
      // ago, he is holding the phone now and the first rung is immediate.
      retries.current = 0;
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `attempt` is here so each attempt re-arms the next rung; the counter it
    // reads is a ref precisely so this effect is the only thing that reattaches.
  }, [live, refusal, attempt]);

  /**
   * THE PROXY'S EVENTS ARE ATTACHED NATIVELY, and that is this round's fix
   * rather than a style preference.
   *
   * Door C shipped with these on React's `onBeforeInput`/`onInput` props and
   * delivered ZERO bytes to any pty. `onBeforeInput` is NOT the native
   * `beforeinput` event: React carries a legacy synthetic event of the same
   * name, and what arrives at `nativeEvent` can be a `TextEvent` with no
   * `inputType` on it at all - which is the one field this lane reads.
   *
   * The compose box's Enter has used a native listener since round 2 for
   * exactly this reason, and that lane was accepted 10/10 on his device under
   * predictive text all session. So this is not a new idea being tried on him;
   * it is the idiom already PROVEN on this hardware, applied to the field that
   * was left on the unproven one.
   *
   * Registered against the element rather than through React, so nothing here
   * depends on which synthetic events a future React version decides to
   * polyfill.
   */
  useEffect(() => {
    const field = proxy.current;
    if (!field) return;
    const onBefore = (event: Event) => captureOne(event as InputEvent);
    const onIn = () => {
      // The modifier lane reads `beforeinput`; nothing needs the commit.
    };
    field.addEventListener("beforeinput", onBefore);
    field.addEventListener("input", onIn);
    return () => {
      field.removeEventListener("beforeinput", onBefore);
      field.removeEventListener("input", onIn);
    };
  }, [captureOne]);

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
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const strip = belt.current;
      if (strip) strip.style.transform = hidden > 0 ? `translateY(-${hidden}px)` : "";

      /* WHAT THE KEYBOARD ACTUALLY COVERS OF *THIS BOX*, which is not the same
       * number as `hidden` and is the defect that shipped with door C.
       *
       * `hidden` asks "how much shorter is the visual viewport than the layout
       * one". It used to compute to ZERO on Chrome, because phone.html asked
       * for `interactive-widget=resizes-content` and a browser that honours it
       * shrinks the LAYOUT viewport too, so the two measurements fell together.
       * Correct for the belt - it needs no lift when the layout already moved
       * it - and exactly wrong as a slide distance, so the slide never ran on
       * the device it was written for. Typing mode went out with its visibility
       * fix silently disabled.
       *
       * That token is GONE as of r8 (see phone.html for the whole reason: it
       * was also resizing the pty to one row every time the keyboard opened),
       * so `hidden` is a real number on Chrome now and the belt lifts on every
       * browser. The measurement below did not have to change for that, and
       * that is the point of it - it reads the rendered box rather than doing
       * viewport arithmetic, so it was already right for both worlds.
       *
       * So the room measures against the BELT'S REAL TOP EDGE, after the belt
       * has been lifted - not against the viewport, and not against a number
       * computed from viewport arithmetic.
       *
       * The viewport bottom is the wrong reference and a bench caught it before
       * this shipped: the belt is lifted to sit ABOVE the keyboard, so it
       * occupies the bottom of what can be seen. Sliding the room until its
       * last row reached the visible bottom parked that row squarely behind the
       * belt. The room has to clear the BELT, which is lower than the keyboard.
       *
       * Measuring the rendered rect also means this cannot drift from the
       * layout again: the type bar moving inside the belt made the belt taller,
       * and a formula built out of viewport numbers would have needed to be
       * told. `getBoundingClientRect` already knows.
       */

      /* THE ROOM SLIDES, IT DOES NOT SHRINK (round 4's rows-floor answer).
       *
       * If he types INTO the room he has to SEE the line he is typing, and the
       * keyboard covers the bottom of it - which is where every prompt lives.
       *
       * The obvious fix is to shrink this box so the fitter drops rows. That
       * would be a pty resize on every keyboard open and close, and a re-render
       * into a shorter pane is exactly the frame collision benched as the real
       * mechanism behind the garbled lines. So the grid is left completely
       * alone and simply MOVED: the bottom edge lands at the top of the lifted
       * belt, the top of the scrollback goes off screen, and
       * `.baud-phone-term-screen` clips it because it is already
       * `overflow: hidden`.
       *
       * Nothing reflows, the room keeps every row, and tmux is never told
       * anything - so there is no damage to bound rather than a bounded amount
       * of it. The taps keep working too, and better: `cellUnder` measures
       * `.xterm-rows` with `getBoundingClientRect`, which reports the
       * TRANSFORMED box, so the slide corrects the aim instead of skewing it.
       */
      const room = host.current;
      const box = room?.parentElement;
      if (room && box && strip) {
        // Measured with the slide OFF, so the reading is the box's true
        // position and not a function of last frame's answer.
        room.style.transform = "";
        const beltTop = strip.getBoundingClientRect().top;
        const covered = Math.max(0, box.getBoundingClientRect().bottom - beltTop);
        /* COVERED, NOT ARMED (r8). The gate used to be `typing && covered`,
         * from a world where the composer's keyboard SHRANK the room - the
         * layout viewport went with it, so the bottom rows stayed on screen by
         * losing rows. r8 dropped `interactive-widget=resizes-content` to stop
         * that pty resize, and the same change means a composer keyboard now
         * hides the room's bottom behind the belt instead of shrinking it.
         * The prompt, and whatever he just sent, live in exactly those rows.
         * So the slide runs for any keyboard: nothing is told to tmux either
         * way, and with no keyboard `covered` is zero by construction, because
         * the belt's top edge IS the screen box's bottom edge. */
        if (covered > 0) room.style.transform = `translateY(-${covered}px)`;
      }
    };
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    place();
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
    // `typing` STAYS A DEPENDENCY even though the slide no longer reads it:
    // the slot changes SHAPE with the mode, so the belt's height changes with
    // it, and every number here is measured off the belt's rendered top edge.
    // A mode flip fires no visualViewport event, so this is the only thing
    // that re-measures - without it the room would keep the slide it computed
    // against the other mode's belt.
  }, [typing]);

  /**
   * What to watch for on screen: the line with every space taken out.
   *
   * Whitespace is dropped from BOTH sides of the comparison because the room
   * is a grid - a line that wraps is broken across rows and a box pads what it
   * draws, so spaces are the one thing that reliably does not survive the trip.
   * A tail rather than the whole line, because the head is what a narrow box
   * truncates first.
   */
  const landmark = useCallback((literal: string): string => {
    const bare = literal.replace(/\s+/g, "");
    return bare.length < LANDMARK_MIN ? "" : bare.slice(-LANDMARK_MAX);
  }, []);

  /** How many times the room is showing that landmark right now. */
  const showings = useCallback((mark: string): number => {
    const xterm = term.current;
    if (!xterm || !mark) return 0;
    const buffer = xterm.buffer.active;
    // The visible screen and one screen of scrollback above it: the compose box
    // is at the bottom, and anything older cannot be this send's echo.
    const from = Math.max(0, buffer.length - xterm.rows * 2);
    let shown = "";
    for (let row = from; row < buffer.length; row += 1) {
      shown += buffer.getLine(row)?.translateToString(true) ?? "";
    }
    // Rows join with NO separator on purpose, so a wrapped line becomes one
    // string again - and the whitespace comes out of the haystack too, because
    // the landmark had its own taken out and half a comparison is no
    // comparison. This was a real bug for about a minute: "enter test" on
    // screen never matches the landmark "entertest".
    return shown.replace(/\s+/g, "").split(mark).length - 1;
  }, []);

  /**
   * Submit once the room has SHOWN the line - or once waiting stops being
   * reasonable.
   *
   * This is the ordering guarantee round 2 assumed and did not have. The CR
   * cannot overtake a paste that has already been drawn, so waiting for the
   * drawing is waiting for the far end to be ready, on its clock rather than a
   * guess at its clock. A line that never appears still submits, because a
   * refusal to submit would be a worse failure than the one being fixed.
   */
  const submitOnceLanded = useCallback(
    (mark: string, before: number) => {
      let waited = 0;
      const submit = () => {
        // The CR is a separate write and can fail on its own. That leaves the
        // line TYPED BUT UNSUBMITTED, which is visible in the room and
        // finishable with the ⏎ chip - so name exactly that, not "not sent".
        if (!write("\r")) {
          setError("the line was typed but not submitted - the room detached mid-send. Reattach and press ⏎.");
        }
      };
      if (!mark) {
        // Too short to recognise on screen. One turn of the loop is still
        // strictly better than the same frame, so it does not go out inline.
        window.setTimeout(submit, SUBMIT_LOOK_MS);
        return;
      }
      const look = window.setInterval(() => {
        waited += SUBMIT_LOOK_MS;
        const landed = showings(mark) > before;
        if (!landed && waited < SUBMIT_CEILING_MS) return;
        window.clearInterval(look);
        submit();
      }, SUBMIT_LOOK_MS);
    },
    [showings, write],
  );

  /**
   * Send the staged line: type it, then submit it.
   *
   * THE SHAPE IS DECLARED, NOT RACED (FPLAN-0446 round 2, 2026-08-19).
   *
   * The old comment here claimed two writes WERE the safety. Measured, they
   * were the bug. Two writes are two WebSocket frames are two writes into the
   * PTY, and whether the far end reads them as one chunk or two is decided by
   * the network: a forked PTY with the child in raw mode reads `line\r` as ONE
   * chunk 30/30 at a 0ms gap and as TWO 30/30 at 1ms or more. A reader with
   * paste detection - Ink, which Claude Code is built on - treats a CR buried
   * inside a chunk as pasted text and does NOT submit, and a lone CR as the
   * Enter key. That knife edge is the submit lottery Patrick called "actualky
   * almost un usable": the same tap, the same button, a different answer.
   *
   * So the line now goes out in a shape that says what it IS. Bracketed paste
   * marks the literal as pasted text, and the `\r` after the closing marker is
   * outside it - unambiguously a keypress, no heuristic left to lose. The race
   * still physically exists and no longer has a losing side; measured through a
   * real tmux client, all four landings are correct:
   *
   *   markers, coalesced -> pane reads `ESC[200~line ESC[201~\r`   (CR outside)
   *   markers, separated -> pane reads `ESC[200~line ESC[201~`, `\r`
   *   no markers, either -> pane reads `line\r` or `line`, `\r`
   *
   * WHOSE MODE IS BEING READ, because round 1 named this instrument wrongly and
   * the measurement corrected it: `modes.bracketedPasteMode` here does NOT
   * report Claude Code. Every room is a tmux session and the phone is a tmux
   * CLIENT, so the peer that parses these bytes is tmux, and tmux turns
   * bracketed paste on for its own client unconditionally. That is not a flaw
   * in the guard - it is exactly right, because the entity whose mode is read
   * is the entity that will interpret the markers. tmux then normalises: it
   * re-emits the paste with markers to a pane that asked for them and STRIPS
   * them for a pane that did not (measured both ways), so a program with no
   * paste detection never sees an escape sequence it did not ask for.
   *
   * The old promise still holds, and by the same mechanism: nothing here can
   * append a newline on the operator's behalf, so a paste can never run itself.
   *
   * ROUND 2 FAILED HIS ACCEPTANCE, AND THE SHAPE WAS NOT ENOUGH (round 2b,
   * same day). Send 1 passed. Send 2 stranded in Claude Code's box through
   * these very markers, and the send after it submitted the STALE line while
   * the fresh text did not appear at all. That signature is an ORDERING
   * INVERSION at the far end, not a paste-detection heuristic: the CR is acted
   * on before the paste it followed is committed, so it submits whatever the
   * box held a moment ago and the pasted text lands in the emptied box behind
   * it. It explains both observations with one mechanism.
   *
   * WHAT THE BENCH COULD AND COULD NOT SETTLE. bash's readline is a genuine
   * bracketed-paste reader and it ran the line correctly on BOTH shapes, four
   * for four - so this is not a general property of paste-aware readers, it is
   * specific to the far end here, and no reader available to bench reproduces
   * it. That is why the fix below waits for EVIDENCE instead of guessing at a
   * debounce it cannot measure.
   */
  function send() {
    const literal = text;
    if (!literal || refusal) return;
    // Ask the peer what it accepts rather than assuming. No terminal yet means
    // no socket either, and `write` below refuses on its own.
    const bracketed = term.current?.modes.bracketedPasteMode ?? false;
    const staged = bracketed ? `\x1b[200~${literal}\x1b[201~` : literal;
    // Counted BEFORE the write, so re-sending a line already on screen cannot
    // be satisfied by the older copy of itself.
    const mark = landmark(literal);
    const before = showings(mark);
    // WRITE FIRST, CLEAR SECOND - and that order is the whole fix. The old
    // order cleared the field and THEN discovered the socket was dead, so
    // Patrick's typed message vanished out of the box into nothing while the
    // sheet sat there looking attached. His words for it were "it would not
    // send", and he was describing the field emptying, which is the one thing
    // that made it look like it had.
    //
    // The text belongs to the operator until the bytes are known to have gone.
    if (!write(staged)) {
      setError(DETACHED);
      return;
    }
    setText("");
    submitOnceLanded(mark, before);
  }

  /**
   * The live `send`, for the native listener below - which registers ONCE and
   * would otherwise close over the first render's empty text forever.
   */
  const sendNow = useRef(send);
  useEffect(() => {
    sendNow.current = send;
  });

  /**
   * ONE SEND PER ENTER, however many ways the browser announces it.
   *
   * Enter is caught twice on purpose (see the listener below). On every browser
   * measured, `preventDefault()` on the keydown suppresses the `beforeinput`
   * that would follow - but "measured" is not "guaranteed", and a double submit
   * would be a worse bug than the one this round is fixing. So the second
   * announcement of the same Enter is dropped, and the flag clears on the next
   * turn of the event loop so the NEXT Enter is its own.
   */
  const announced = useRef(false);
  const submitOnce = useCallback(() => {
    if (announced.current) return;
    announced.current = true;
    window.setTimeout(() => {
      announced.current = false;
    }, 0);
    sendNow.current();
  }, []);

  /**
   * ENTER, CAUGHT THE WAY ANDROID ACTUALLY SENDS IT (FPLAN-0446 round 2).
   *
   * The composer's `onKeyDown` tested `event.key === "Enter"` and nothing else,
   * which is precisely the one signal Gboard does not deliver: with predictive
   * text on, keydown arrives as `Unidentified` / keyCode 229 and the operator's
   * intent only exists in `beforeinput`. So the handler never ran, the textarea
   * took the break, and the sanitiser in `onChange` flattened it to a space -
   * Patrick's third outcome, the one where Enter appears to do nothing at all.
   * That is why it was Enter-only and the send button never shared it.
   *
   * BELT AND BRACES, the same reasoning as the `readOnly` + `inputMode` pair
   * this file already uses for the keyboard: keep the keydown path and add the
   * input-intent path, because the round must not hinge on which signal this
   * month's keyboard fires. A NATIVE listener rather than React's synthetic
   * `onBeforeInput`, because `inputType` and `isComposing` are the whole point
   * and reading them off the real event removes any question of what React's
   * wrapper does with them.
   *
   * `isComposing` is the guard: an Enter that closes an IME composition is the
   * operator accepting a WORD, not submitting a line. Send on the next one.
   */
  useEffect(() => {
    const field = compose.current;
    if (!field) return;
    const intent = (event: InputEvent) => {
      if (event.isComposing) return;
      if (event.inputType !== "insertLineBreak" && event.inputType !== "insertParagraph") return;
      event.preventDefault();
      submitOnce();
    };
    field.addEventListener("beforeinput", intent);
    return () => field.removeEventListener("beforeinput", intent);
    // `typing` IS A DEPENDENCY, and it is load-bearing rather than tidy. The
    // slot swaps its contents for the armed bar, so this textarea UNMOUNTS on
    // arm and a brand-new one mounts on disarm. Without `typing` here the
    // effect would not re-run, `compose.current` would be a fresh element
    // nobody listened to, and Enter would stop sending the moment he came back
    // from typing mode - the composer's own lane, broken by a mode it is not
    // even in. The dependency is what makes "morphs in place" safe.
  }, [submitOnce, typing]);

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
    // `typing` for the same reason as the Enter listener above: coming back
    // from armed mode mounts a fresh textarea with no scripted height, and a
    // half-written three-line message would be shown one line tall until the
    // next keystroke. React keeps `text` across the swap; this keeps the shape
    // of it.
  }, [text, typing]);

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

  /** A key chip. Same promise as every other control, so the same audit.
   *
   *  EVERY chip drops the mirror, and this is the single funnel that makes the
   *  drift rule enforceable rather than aspirational: esc, tab, ^C, the arrows
   *  and ⏎ all arrive here, and every one of them can move the room's cursor
   *  or rewrite its line (tab-completion rewrites it outright). After any of
   *  them BAUD no longer knows what the line holds, so it stops pretending to. */
  function press(bytes: string) {
    // A chip IS user input, so the view goes where user input goes. xterm's
    // `input()` would do this via `scrollOnUserInput`, and the spec asked for
    // it, but routing chip bytes through `input()` sends them out of `onData`
    // - the one lane that applies the sticky modifiers - and they have already
    // been through it here. That is a double transform, so the scroll is taken
    // directly and the bytes keep their single path.
    term.current?.scrollToBottom();
    if (!write(bytes)) setError(DETACHED);
  }

  /**
   * THE TYPE BAR'S ONE JOB: arm, or disarm - and what it arms is now XTERM'S
   * OWN TEXTAREA, not a field of BAUD's beside it.
   *
   * Door C typed into a hidden proxy and reconstructed the room's line by
   * diffing that field against a remembered copy. That pattern is dead, and it
   * is dead on evidence rather than taste: noVNC shipped it (PR #301, 2013,
   * for our exact reason - Chrome Android sends no usable key events) and
   * REMOVED it, because a mirror cannot know when the far end rewrites its own
   * line (issue #357, closed 2015 without a fix). A tmux room rewrites its line
   * constantly - tab completion, ctrl-R, prompt redraws, background output, vim
   * modes - so every one of those desynced BAUD's copy, and the next keystroke
   * paid for it with backspaces computed against text the operator never typed.
   *
   * The fence round 3 built is kept, but it moves from CAPABILITY to MODE.
   * Disarmed, the textarea is still focusable and still xterm's - it just
   * carries `inputMode="none"`, so a stray tap in the room raises no keyboard
   * and the mis-aim trap stays shut. Armed, it is a normal text field and
   * xterm handles it: composition, autocorrect commits and multi-byte input all
   * resolve inside xterm before `onData` ever fires, which is the same lane the
   * modifier chips have always trusted.
   *
   * What that buys without building it: xterm parks this textarea ON THE CURSOR
   * CELL as the cursor moves, and paints in-progress composition there in the
   * terminal's own font. TEXT APPEARS IN THE ROOM AS HE TYPES - the thing
   * Patrick asked for - because the browser is drawing it where the room says
   * the cursor is.
   */
  const toggleTyping = useCallback(() => {
    // THE REF IS THE SOURCE, NOT THE UPDATER. This read the previous state
    // inside a `setTyping` updater and did its work in there - focus and the
    // flag - which is a side effect in a function React
    // requires to be pure and is allowed to call more than once. A replay that
    // saw the already-toggled value would flip the flag back to false while
    // the committed state stayed true: a bar showing ARMED over a lane that
    // believes it is idle, which is precisely how the live failure looked.
    const now = !typingOn.current;
    typingOn.current = now;
    armedAt.current = Date.now();
    setTyping(now);
    // The mode is the fence, so flipping the mode IS the arm. Focus second:
    // the tap on this bar is the user gesture that makes opening a keyboard
    // allowed at all, and it only opens against a field that accepts text.
    allowKeyboard(now);
    if (now) term.current?.focus();
    else helperField()?.blur();
    /* AND THE RAIL IS TOLD, which it was not before r8 and now must be.
     *
     * `onComposeFocus` means what its comment says - "the soft keyboard is
     * about to eat half the screen" - and in armed mode it is. Two reasons it
     * has to be said HERE rather than left to the textarea's own handlers.
     * The honest one: the keyboard is open in both modes, so a rail that only
     * compacts for the composer is compacting for the wrong half of the
     * feature. The mechanical one: the textarea now UNMOUNTS on arm, and an
     * unmounted element fires no blur - so without this the rail would stay
     * compacted forever after one trip through typing mode.
     *
     * LAST, AND THAT ORDER IS DELIBERATE. `term.current.focus()` above pulls
     * focus off the compose textarea while it is still mounted, which fires
     * its `onBlur` synchronously - and that handler says `false`. Said before
     * the focus move, this would be overwritten by it and the rail would stay
     * open over an armed room. Said after, it is the last word.
     */
    onComposeFocus?.(now);
  }, [allowKeyboard, helperField, onComposeFocus]);

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
        // The operator is waiting on a delivery, so this is a hand-driven
        // retry and starts the ladder over, exactly as the button does.
        reattachNow();
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

      {/* THE DOOR BACK IN MOVED ONTO THE GRID (r5) - see the overlay below.
          It was a line above the terminal, which is a line an operator can
          scroll past, glance over, or simply not connect to the picture that
          still looks like a room. The picture is what lies, so the correction
          goes on the picture. */}

      {/* Refused, never hidden, and never a dead button: a read token gets the
          sheet, the reason, and no socket. */}
      {refusal ? (
        <p className="baud-phone-term-refused">
          read-only session — {refusal}. An attached room is a shell prompt, so it needs operate.
        </p>
      ) : null}

      <div className="baud-phone-term-screen">
        <div ref={host} className="baud-phone-term-host" />
        {/* A DEAD ROOM HAS TO LOOK DEAD, and until this it did not.
            xterm keeps painting the last frame it was handed - it can do
            nothing else, the bytes simply stopped - so a detached room and a
            quiet room are the same picture, and Patrick spent an evening
            typing into one of them. The overlay is deliberately ON the grid
            rather than above it: it covers the thing that is lying, it cannot
            be scrolled away from, and it is where a thumb already is.
            The stale frame stays legible underneath, dimmed. It is the last
            true thing the room said and is often still worth reading - what it
            must never again do is pass for now. */}
        {!refusal && !live && (opened || !reconnecting) ? (
          <div className="baud-phone-term-dead">
            <p className="baud-phone-term-dead-word">{opened ? "detached" : "not attached"}</p>
            <p className="baud-phone-term-dead-why">
              {opened
                ? `${roomLabel} is still running. This is the last frame the phone was sent, not the room now.`
                : `the phone has not got into ${roomLabel}.`}
            </p>
            <button type="button" className="baud-phone-term-reattach" onClick={reattachNow}>
              {reconnecting ? "reattaching…" : `reattach to ${roomLabel}`}
            </button>
            {/* Two different situations, said in two different sentences: a
                retry is armed, or the phone has stopped trying by itself. A
                UI that shows the same thing for both is telling one of them a
                lie, and the one it lies to is the operator waiting on a
                reconnection that is never coming. */}
            <p className="baud-phone-term-dead-why">
              {reconnecting
                ? "trying again by itself while this screen is open"
                : "not trying any more - the room did not answer. Tap to try again."}
            </p>
          </div>
        ) : null}
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
              width="17"
              height="17"
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
          {/* THE ARROWS, moved off the belt - see CHIPS_ARROWS for the ruling
              and the ordering.

              HoldButton, NOT a plain onClick like the three chips above it,
              and that is load-bearing rather than tidy: its `onPointerDown`
              calls `preventDefault` so a press cannot pull focus off the
              terminal, and on a phone losing focus DISMISSES THE SOFT
              KEYBOARD. Zoom and select never cared - they are pressed with the
              keys already shut. An arrow is pressed mid-typing, walking a menu
              with the keyboard up, so a plain button here would shut the keys
              on the operator every single tap. Same reason the belt has always
              used it (see its own comment).

              `pressChip`, not `press`, so a latched CTRL/ALT still modifies
              them - the sticky lives in the belt and the arrows now live here,
              but the latch is component state that both read, so Ctrl+arrow
              survives the move intact. */}
          {CHIPS_ARROWS.map((chip) => (
            <HoldButton
              key={chip.label}
              className="baud-phone-term-viewbtn baud-phone-term-arrowbtn"
              disabled={Boolean(refusal)}
              title={refusal ?? chip.title}
              onTap={() => pressChip(chip)}
            >
              {chip.label}
            </HoldButton>
          ))}
        </div>
      </div>

      {/* THE BELT: the key row and the compose bar, one strip, lifted above
          the soft keyboard by the visualViewport effect - see its comment. */}
      <div ref={belt} className="baud-phone-term-belt">
        {/* THE TYPE BAR IS NOT HERE ANY MORE, and its row went back to the
            terminal (r8, Patrick 00:39: *"type in this room, its going to be
            the only chatbox we need... I dont need 2 comment boxes"*).

            It was a permanent row above this belt, which is the cost door C
            was chosen for paying honestly - and once typing mode worked, that
            row was a SECOND compose surface parked above the first. The two
            are now one slot at the bottom of this belt with two modes; see it
            there. What did NOT merge is the mechanism: the room still takes
            raw keys and the baud box still predicts, because per-keystroke
            terminal input and predictive text cannot share one surface. This
            round merges the FOOTPRINT, not the lane. */}
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
        {/* THE CHIP ROW'S OWN FIELD. It lives here, inside the row that owns
            it, rather than off in a corner of the sheet - the keyboard this
            opens belongs to these two buttons and to nothing else.

            Visually absent, NOT display:none: a field that is not rendered
            cannot take focus, and focus is the entire mechanism. It is one
            pixel, transparent and unreachable by a thumb, so the only way in
            is arming a modifier.

            autoCorrect/autoCapitalize/spellCheck off, and it never holds a
            value for longer than one event - there is nothing here for a
            keyboard to predict FROM - which was the point until typing mode,
            and it stays that way: typing mode no longer touches this field at
            all - it arms xterm's own textarea instead. */}
        <input
          ref={proxy}
          className="baud-phone-term-proxy"
          type="text"
          // NOT `aria-hidden` any more. It was, and a focused aria-hidden
          // element is a contradiction the platform is entitled to resolve
          // however it likes - which is a poor thing to be relying on when the
          // whole feature is "this field receives the keyboard". A label
          // instead: honest to assistive tech, and nothing refuses to attach.
          aria-label="terminal keyboard input"
          // UNCONTROLLED, and NOT readOnly. Both are load-bearing: a readOnly
          // field fires no `beforeinput` at all - it is the very trick this
          // sheet uses elsewhere to keep a keyboard shut - and a React-
          // controlled value would fight the imperative clearing that keeps
          // this field empty between keystrokes.
          defaultValue=""
          tabIndex={-1}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          // enterKeyHint so the soft keyboard offers a sensible return key
          // while typing mode is armed - it is the room's Enter, not a form's.
          enterKeyHint="send"
          // `beforeinput` and `input` are attached NATIVELY in an effect below,
          // NOT here - see it for why. React's `onBeforeInput` is a different
          // event wearing the same name.
          // NO onBlur. There was one, and it disarmed typing mode when this
          // field lost the keyboard. Typing mode does not live here any more -
          // it arms xterm's own textarea, and that textarea's blur is watched
          // in the attach effect - so a handler here would be a no-op wearing
          // a safety mechanism's clothes.
        />
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
                  // arming focuses one - the tap is a user gesture, which is
                  // what lets focus() open the keys at all.
                  //
                  // ARMING A STICKY IS TYPING INTENT, stated rather than
                  // guessed at from a coordinate - so this lane opens the
                  // keyboard from anywhere in the room, and it is the answer
                  // for a room whose input is not at the bottom.
                  //
                  // ROUND 3 MOVED WHICH FIELD, not whether: the keyboard now
                  // opens against the chip row's own input, never xterm's, so
                  // what it produces is translated here instead of reaching
                  // the pty as composition. Disarming shuts it again - a
                  // keyboard with no modifier behind it has nothing to type.
                  if (state === "idle") openProxy();
                  else closeProxy();
                }}
                onHold={() => {
                  set("locked");
                  openProxy();
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

        {/* THE PICKER, and it sits OUTSIDE the slot on purpose. It is `hidden`,
            so it costs the belt nothing wherever it hangs - and the slot below
            swaps its contents for the armed bar, which would unmount this
            input mid-upload if it lived in there. `sendPhoto` writes to
            `picker.current` after an await; a ref that can go null under a
            mode change is a race nobody would ever reproduce on purpose.

            `accept="image/*"` is the whole integration: Android offers the
            camera AND the gallery from this one input, with no native code and
            no permissions dance. `capture` is deliberately NOT set - it would
            force the camera and lock out the screenshot Patrick actually
            asked for. */}
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
        {/* ------------------------------------------------------ THE ONE SLOT
            Patrick's ruling of 00:39, r8: one input footprint, not two. The
            same rectangle carries both modes and MORPHS between them.

              default - the baud composer, unchanged to the byte: attach, a
                        predictive textarea (his voice dictation lands in it),
                        commit-on-send with the draw handshake behind it.
              armed   - raw keys to the room, and the whole rectangle says so.

            THE MODE IS ALWAYS LITERAL WORDS, never a lit icon - his trust rule,
            and the one thing this round could not trade away for width. Armed
            reads its state in a whole sentence; disarmed, the door into it is
            the word `room`.

            THE COST IS NAMED, and MEASURED off the built stylesheet at 360px
            rather than estimated. The arm door takes the compose field from
            221px to 175px - ~23 characters a line down to ~17 - and its
            max-height went up to hold roughly the same amount of his message
            as before (~120 characters visible, now ~112; at the old cap it
            would have been ~89). What it buys: the belt goes 143px to 111px
            with the box empty, which is 32px - about two rows - handed back to
            the terminal permanently. */}
        {/* NO STATE CLASS ON THE ROW. There was one and it styled nothing: the
            armed bar fills the slot on its own `flex: 1`, so the row needs to
            know nothing about the mode. The mode is already legible from the
            child that is mounted - `-typebar-on` or `-arm` - which is a truer
            signal than a class the row carries on its behalf. */}
        <div className="baud-phone-term-input">
        {typing ? (
        /* ARMED. Loud, and the loudness is the point: every keystroke is
           leaving this face for a real program. The bar occupies the slot the
           composer had, so there is no doubt about which surface is live - the
           composer is not sitting beside it greyed out, inviting a mis-aim. It
           is the whole control, and a tap anywhere on it stops. */
        <button
          type="button"
          className="baud-phone-term-typebar baud-phone-term-typebar-on"
          aria-pressed
          title="typing goes to the room - tap to stop, put the keyboard away and get the baud box back"
          // NO FOCUS THEFT - the rule `HoldButton` has carried since DPLAN-0301
          // and the one door C failed to apply, which is the likeliest reason
          // it typed nothing. Tapping a <button> gives IT the focus; the
          // handler then moves focus elsewhere, and on a phone those two can
          // land in either order. If the button's focus arrives second, the
          // field is blurred the instant it was focused - keyboard gone or
          // pointed at the wrong place, bar still showing armed.
          onPointerDown={(event) => event.preventDefault()}
          onClick={toggleTyping}
        >
          typing → the room · raw keys · tap to stop
        </button>
        ) : (
        <>
        {/* THE DOOR IN. Leftmost, so the paperclip keeps its own rule - it sits
            directly LEFT OF THE LINE IT WRITES INTO - and so the right edge of
            the row stays what it has always been: send, under the thumb.
            Quiet: dim ink, no accent, no glow. It is doing nothing yet, and it
            must not compete with the room above it while that is true. */}
        <button
          type="button"
          className="baud-phone-term-arm"
          disabled={Boolean(refusal)}
          aria-pressed={false}
          title={
            refusal ??
            "type directly in the room: the keyboard opens, characters land in the room as you type, and autocorrect stays out of the way - this box is the predictive one and it comes back when you stop"
          }
          onPointerDown={(event) => event.preventDefault()}
          onClick={toggleTyping}
        >
          room
        </button>
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
              // It also suppresses the `beforeinput` that would otherwise
              // announce the same Enter a second time - see `submitOnce`.
              event.preventDefault();
              submitOnce();
            }
          }}
        />
        <button
          type="button"
          className="baud-phone-term-send"
          disabled={Boolean(refusal) || !text}
          title={refusal ?? "type this line, then submit it"}
          // THE SAME PATH AS ENTER, to the byte. Patrick's own observation -
          // "the send button is exactly as inconsistent" - is what proved the
          // lottery lived below the keyboard, and the two must never be able
          // to drift apart again. Sharing `submitOnce` also means a double tap
          // cannot fire two sends.
          onClick={submitOnce}
        >
          send
        </button>
        </>
        )}
        </div>
      </div>
    </section>
  );
}
