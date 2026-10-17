/** The phone's terminal: a real tmux client attached to the room over @api's socket.
 * Reference: docs/phone/room.md */

import { type FocusEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { type ILink, Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { deliveryText } from "../deliver";
import { openRoomSocket, uploadImage } from "../host";
import { HostError } from "../host/transport.http";
import { markRoomEnded } from "../intent";
import type { BranchStatus } from "../types";
import { SCROLL_MAX, SCROLL_MIN, SCROLL_NEUTRAL } from "./PhoneSettings";
import { copyReport, copyThrough } from "./lib/copyPath";
import { coversRow, findLinks, readRows, recentUrls } from "./lib/roomLinks";
import { type PhoneMode, launchCommand, typeOnAttach } from "./lib/rooms";
import {
  type CloseKind,
  closeIsFinal,
  closeKind,
  deadFace,
  errorAfterClose,
  roomStatusAfterClose,
} from "./lib/socketClose";
import { type Scope, scopeRefusal } from "./lib/verbs";

// Key bar chips write the exact bytes a keyboard writes; stickies follow Termux (tap latches, long-press locks).
type Sticky = "idle" | "latched" | "locked";

/** xterm's own modified-arrow parameter: 1 + shift·1 + alt·2 + ctrl·4. */
function arrowParam(ctrl: boolean, alt: boolean): number {
  return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

/** One character under the stickies, in xterm's order; null when Ctrl has no byte for it (pass it through). */
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

/** What of `whole` the room has not been told yet: one word can arrive through two doors, in either order. */
function unsaid(whole: string, said: string): string {
  if (!whole) return "";
  if (!said) return whole;
  if (whole.startsWith(said)) return whole.slice(said.length);
  return said.includes(whole) ? "" : whole;
}

// Bytes for an editing intent, from the event, never the field (Gboard's composition never fills it).
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
  hold?: { bytes: string; title: string };
  /** CSI arrow letter - the one chip family that honors latched modifiers. */
  arrow?: "A" | "B" | "C" | "D";
}

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

const CHIPS_RIGHT: ReadonlyArray<ChipSpec> = [
  // Pre-baked despite sticky CTRL: interrupt is the panic button, not a two-tap race.
  { bytes: "\x03", label: "^C", title: "interrupt - the byte Ctrl+C sends" },
  {
    bytes: "\r",
    label: "⏎",
    title: "submit the line. HOLD: newline WITHOUT submitting (Ctrl+J - the one both TUIs honor)",
    hold: { bytes: "\n", title: "newline, no submit" },
  },
];

const CHIPS_ARROWS: ReadonlyArray<ChipSpec> = [
  { bytes: "\x1b[A", label: "↑", title: "Up arrow - menus, history. Does NOT scroll.", arrow: "A" },
  { bytes: "\x1b[B", label: "↓", title: "Down arrow - menus, history. Does NOT scroll.", arrow: "B" },
  { bytes: "\x1b[D", label: "←", title: "Left arrow (latched CTRL/ALT modify it)", arrow: "D" },
  { bytes: "\x1b[C", label: "→", title: "Right arrow (latched CTRL/ALT modify it)", arrow: "C" },
];

/** A chip with a long-press lane; the context menu is suppressed or Android's selection long-press fires over the hold. */
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
        // No focus theft: on a phone, losing focus dismisses the soft keyboard.
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

// A pan sends the room wheel events so tmux copy-mode scrolls: the history lives in tmux, not in this xterm.

/** tmux's default `WheelUpPane` step: a tuning constant, shared with MonitorSheet's pan. */
export const LINES_PER_NOTCH = 5;

/** Pan speed over 1:1; the baseline `terminal_scroll_percent` scales, so an absent key computes exactly this. */
export const PAN_ACCELERATION = 3;

// How long the CR waits for the line to show in the room before going anyway (the paste commits on the far end's clock).
const SUBMIT_CEILING_MS = 600;

const SUBMIT_LOOK_MS = 16;

/** Shorter landmarks match half the transcript; below this the ceiling carries the send. */
const LANDMARK_MIN = 4;

const LANDMARK_MAX = 32;

const BLUR_GRACE_MS = 500;

/** Debounce so the pty hears the size the box came to rest at, not every frame of a rotation or pane change. */
const FIT_DEBOUNCE_MS = 120;

// Liveness: a browser never sees protocol ping/pong, so a dead room looks quiet. One `{type:"ping"}` probe per
// socket; a pong switches to measured round trips. Never retry it: an old host logs a warning per unknown frame.

/** Silence before the phone stops believing a room: 3x the worst idle gap measured (29s); shorter kills healthy rooms. */
const SILENCE_MS = 90_000;

const LIVENESS_TICK_MS = 10_000;

/** A round trip is overdue after three ticks, so one lost tick is never a verdict. */
const PONG_DEAD_MS = 30_000;

/** Reconnect ladder by failures: the first rung is immediate, later ones back off since each attach repaints the desk. */
export const RECONNECT_MS = [0, 1_000, 3_000, 6_000, 12_000, 30_000];

/** Tries before the phone stops and says so; the overlay button stays live. Shared with MonitorSheet's watch. */
export const RECONNECT_TRIES = RECONNECT_MS.length;

export const HANDSHAKE_POLL_MS = 1_000;

export const MIN_FONT = 7;
export const MAX_FONT = 18;
/** Fully zoomed out on open. Declared after MIN_FONT: reading it earlier is a TDZ error at import. */
const DEFAULT_FONT = MIN_FONT;

/** A close code's sentence: 1008 is the caller's and fixable, 1011 the host's; both arrive after accept so they render. */
function closeSentence(event: CloseEvent): string | null {
  if (event.code === 1008) return event.reason || "the room refused this request";
  if (event.code === 1011) return event.reason || "the host could not open the room";
  // 1000/1001/1005/1006 are a detach or a dropped link, and 4000 is the overlay's to say: none is an error.
  return null;
}

const DETACHED =
  "not sent: the room is detached. Reattach and try again - nothing was lost in the room.";

/** Rows either side of the hovered one the link provider reads, so a URL wrapped over several rows is found whole. */
const LINK_REACH = 40;
const PANEL_URLS = 8;

/** Open a room URL in a new tab; `findLinks` admits only http(s), and noopener keeps the page off this face. */
function openRoomLink(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

type Takeout =
  | { kind: "text"; text: string; note: string }
  | { kind: "links"; urls: string[]; rows: number }
  | null;

interface TerminalSheetProps {
  branch: BranchStatus;
  /** Which door was pressed; a live room arrives as `resume` that types nothing (attach is not a mode). */
  mode: PhoneMode;
  /** One command line typed into a shell pane when it opens, or null for a bare prompt; launch modes never carry one. */
  command?: string | null;
  scope: Scope;
  /** Pan speed as a percent of the baselines, neutral at 100; read through a ref so a change never reattaches. */
  scrollPercent?: number;
  /** A pane restored after a reload: a reattach that types nothing, so a room left at a prompt gets the prompt back. */
  restored?: boolean;
  /** The compose field took or lost focus; reported up because the rail must make room for the keyboard. */
  onComposeFocus?: (focused: boolean) => void;
}

export default function TerminalSheet({
  branch,
  mode,
  command = null,
  scope,
  scrollPercent = SCROLL_NEUTRAL,
  restored = false,
  onComposeFocus,
}: TerminalSheetProps) {
  // Frozen at the door press: the fleet hands down a new card every poll, which would re-run the attach.
  const attachedTo = useRef(branch).current;
  const opener = useRef(command).current;
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
  const compose = useRef<HTMLTextAreaElement | null>(null);
  const [status, setStatus] = useState("opening the room…");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Attempts in a row with no frame of the room; reset on the first data frame, since @api accepts before refusing. */
  const retries = useRef(0);
  const [reconnecting, setReconnecting] = useState(false);
  /** Has this sheet ever attached? Without it every normal open flashes "detached" over an empty grid. */
  const [opened, setOpened] = useState(false);
  const [closed, setClosed] = useState<CloseKind | null>(null);
  const reattachNow = useCallback(() => {
    retries.current = 0;
    setAttempt((n) => n + 1);
  }, []);
  // The launch line is typed once per sheet (a reattach would start a second claude); already spent on a restored pane.
  const launched = useRef(restored);
  /** A delivery that outlived its socket; `path` is every path it carries, space-joined. */
  const pending = useRef<{ bytes: string; path: string } | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const [font, setFont] = useState(DEFAULT_FONT);
  /** Born-with size, through a ref so `font` never joins the attach deps (a zoom tap would reattach). */
  const fontAtMount = useRef(font);
  // Through a ref like zoom, so a saved preference never reattaches; bounded again because it ends up under a division.
  const speed = useRef(SCROLL_NEUTRAL);
  useEffect(() => {
    speed.current =
      Number.isFinite(scrollPercent) && scrollPercent >= SCROLL_MIN && scrollPercent <= SCROLL_MAX
        ? scrollPercent
        : SCROLL_NEUTRAL;
  }, [scrollPercent]);
  /** Fullscreen is a class, never a remount: the sheet is keyed by room, so unmounting it detaches. */
  const [full, setFull] = useState(false);

  // Selection forges shiftKey mouse events, which xterm selects locally instead of forwarding to the pty.
  const [selecting, setSelecting] = useState(false);
  /** The armed flag for the touch listeners, which are bound once per attach. */
  const selectingRef = useRef(false);
  selectingRef.current = selecting;
  const [selText, setSelText] = useState("");
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [takeout, setTakeout] = useState<Takeout>(null);
  const [linkNotes, setLinkNotes] = useState<Record<string, string>>({});
  // `dragging` gates the forged events and holds the fit (a fit mid-drag drops the selection); `heldFit` owes one.
  const drag = useRef({ dragging: false, heldFit: false });
  const refusal = scopeRefusal(scope);
  const [ctrlMod, setCtrlMod] = useState<Sticky>("idle");
  const [altMod, setAltMod] = useState<Sticky>("idle");
  const mods = useRef({ ctrl: "idle" as Sticky, alt: "idle" as Sticky });
  mods.current = { ctrl: ctrlMod, alt: altMod };

  // The chip row's own field: ctrl/alt open the keyboard against it, so only bytes BAUD chose reach the pty.
  const proxy = useRef<HTMLInputElement | null>(null);

  // Focus stays (clicks, word selection, keys) but `inputMode none` + `readOnly` (Chrome, Firefox) block the keyboard.
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

  const consumeLatch = useCallback(() => {
    setCtrlMod((s) => (s === "latched" ? "idle" : s));
    setAltMod((s) => (s === "latched" ? "idle" : s));
  }, []);

  // Stickies on onData, after xterm's IME handling; only single characters transform, so a paste keeps the latch.
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

  /** Bytes out, reporting whether they went: a silent no-op let callers claim delivery over a dead socket. */
  const write = useCallback((bytes: string): boolean => {
    const open = socket.current;
    if (!open || open.readyState !== WebSocket.OPEN) return false;
    // Binary always: @api never routes a text frame to the PTY.
    open.send(new TextEncoder().encode(bytes));
    return true;
  }, []);

  const [typing, setTyping] = useState(false);
  const typingOn = useRef(false);
  useEffect(() => {
    typingOn.current = typing;
  }, [typing]);
  const armedAt = useRef(0);

  // The composition in flight: one word arrives through its building events and `compositionend`, so `sent` stops
  // the second door repeating it. `text` matters: a space key commits a word with no `compositionend` at all.
  const composing = useRef({ on: false, text: "", sent: "", start: 0 });

  const openProxy = useCallback(() => {
    const field = proxy.current;
    if (!field) return;
    field.value = "";
    field.focus();
  }, []);

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

      // Nothing is ever committed to this field; it exists to be read, so every path clears it.
      event.preventDefault();
      const typed = event.data ?? "";
      field.value = "";
      if (event.isComposing || typed.length !== 1) return;
      if (!ctrlOn && !altOn) {
        // Both modifiers dropped while the keyboard was up: a bare letter goes nowhere and the door shuts.
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
      setStatus("not attached");
      return;
    }

    const xterm = new XTerm({
      convertEol: false, // a real stream carries its own CR - converting would double it
      fontSize: fontAtMount.current,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace',
      cursorBlink: true,
      scrollback: 2_000,
      theme: { background: "#070a09", foreground: "#d6e2dc" },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host.current);
    fit.fit();
    term.current = xterm;
    fitRef.current = fit;
    // A link provider, not WebLinksAddon: the addon joins only soft wraps, and login URLs arrive hard-wrapped.
    const links = xterm.registerLinkProvider({
      provideLinks(y, callback) {
        const buffer = xterm.buffer.active;
        const row = y - 1;
        let from = Math.max(0, row - LINK_REACH);
        while (from > 0 && buffer.getLine(from)?.isWrapped) from -= 1;
        const found = findLinks(readRows(buffer, from, row + LINK_REACH + 1), xterm.cols, from).filter((link) =>
          coversRow(link, row),
        );
        const out: ILink[] = found.map((link) => ({
          range: {
            start: { x: link.start.col + 1, y: link.start.row + 1 },
            end: { x: link.end.col + 1, y: link.end.row + 1 },
          },
          text: link.url,
          activate: () => {
            // Selection forges mouse events, and a drag over a URL must not open it.
            if (selectingRef.current) return;
            openRoomLink(link.url);
          },
        }));
        callback(out.length ? out : undefined);
      },
    });
    // A room opens with the keyboard down, again on every reattach; the helper textarea exists only after open().
    allowKeyboard(false);
    // Armed, BAUD sends from the events, so xterm's key paths (which read the textarea back) are cut to stop repeats.
    xterm.attachCustomKeyEventHandler(() => !typingOn.current);
    typingOn.current = false;
    setTyping(false);

    // The bar follows the keyboard down on blur; the grace window skips the blur that arming itself can cause.
    const onHelperBlur = () => {
      if (!typingOn.current) return;
      if (Date.now() - armedAt.current < BLUR_GRACE_MS) return;
      typingOn.current = false;
      setTyping(false);
      allowKeyboard(false);
    };
    const helper = helperField();
    helper?.addEventListener("blur", onHelperBlur);

    /** One typed thing to the room; it scrolls the view itself since nothing reaches xterm's input path while armed. */
    const toRoom = (text: string) => {
      if (!text) return;
      if (composing.current.on) composing.current.sent += text;
      xterm.scrollToBottom();
      if (!write(throughMods(text))) setError(DETACHED);
    };

    const onCompositionStart = () => {
      composing.current = { on: true, text: "", sent: "", start: helper?.value.length ?? 0 };
    };

    const onCompositionUpdate = (event: CompositionEvent) => {
      composing.current.text = event.data ?? "";
    };

    // The committed word: event data first (Gboard commits words the field never sees), then the field, then the update.
    const onCompositionEnd = (event: CompositionEvent) => {
      const { on, text, sent, start } = composing.current;
      composing.current = { on: false, text: "", sent: "", start: 0 };
      const held = helper?.value ?? "";
      // Emptied on every commit, armed or not, or xterm's delayed read sends the word a second time.
      if (helper) helper.value = "";
      if (!typingOn.current || !on) return;
      toRoom(unsaid(event.data || held.slice(start) || text, sent));
    };

    // Non-composition edits, which xterm drops on Android (a Gboard insert is composed while a keydown is open).
    const onHelperInput = (event: InputEvent) => {
      if (!typingOn.current || event.isComposing) return;
      const bytes = editBytes(event);
      if (bytes === null) return;
      // A non-composing edit mid-composition is its commit: the word goes first, and `on` stays for a late compositionend.
      if (composing.current.on) toRoom(unsaid(composing.current.text, composing.current.sent));
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
    // Bytes, not Blobs or strings: decoding here would break UTF-8 split across chunks.
    live.binaryType = "arraybuffer";
    socket.current = live;

    const sendResize = () => {
      if (live.readyState !== WebSocket.OPEN) return;
      const { cols, rows } = xterm;
      if (cols > 0 && rows > 0) {
        live.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };

    let lastRx = Date.now();
    let lastPong = 0;
    let pongLane = false;
    let silenced = false;
    let watchdog = 0;
    /** A handshake refusal never reaches `onopen`, and its close must not wipe what `onerror` wrote. */
    let reachedOpen = false;
    let heard = false;

    /** Probe and keepalive, as a text frame: text is control on @api's side, so it is never typed into the room. */
    const ping = () => {
      if (live.readyState !== WebSocket.OPEN) return;
      live.send(JSON.stringify({ type: "ping" }));
    };

    const tick = () => {
      if (live.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (pongLane) {
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

    /** The watchdog runs only while visible: a socket that dies in a pocket is found on the next look. */
    const watch = (on: boolean) => {
      window.clearInterval(watchdog);
      watchdog = 0;
      if (on) watchdog = window.setInterval(tick, LIVENESS_TICK_MS);
    };

    // The first room output proves the room (@api accepts before refusing); only then reset the ladder and type.
    const firstFrame = () => {
      retries.current = 0;
      // Only the launch modes type, once per sheet, with the newline: a reattach must not re-run it.
      if (!launched.current && (mode === "resume" || mode === "fresh") && typeOnAttach(attachedTo)) {
        launched.current = true;
        write(`${launchCommand(attachedTo, mode)}\n`);
      }
      // The card's `?` shares `launched`; no `typeOnAttach` guard, which reads the agent's room, not this shell room.
      if (!launched.current && mode === "shell" && opener) {
        launched.current = true;
        write(`${opener}\n`);
      }
    };

    live.onopen = () => {
      reachedOpen = true;
      setLive(true);
      setOpened(true);
      setClosed(null);
      setStatus(`attached · ${roomLabel}`);
      setError(null);
      // The size first: @api opens the PTY at 80x24, and `window-size smallest` lets this settle the geometry.
      sendResize();
      ping();
      lastRx = Date.now();
      if (document.visibilityState === "visible") watch(true);
      // A delivery stranded by a dead socket (the photo picker backgrounds the app) goes on the first open.
      const waiting = pending.current;
      if (waiting) {
        pending.current = null;
        if (write(waiting.bytes)) setStatus(`delivered · ${waiting.path}`);
      }
    };

    live.onmessage = (event) => {
      lastRx = Date.now();
      if (event.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(event.data));
        if (!heard) {
          heard = true;
          firstFrame();
        }
        return;
      }
      // Text is control. Only the pong is looked for; anything else is ignored so a future host can extend it.
      if (typeof event.data !== "string") return;
      let control: unknown;
      try {
        control = JSON.parse(event.data);
      } catch {
        return;
      }
      if (control && typeof control === "object" && (control as { type?: unknown }).type === "pong") {
        lastPong = Date.now();
        pongLane = true;
      }
    };

    live.onerror = () => {
      // No code here; the one thing that refuses before establishment is auth.
      setError("the room refused this connection - the token was rejected, or the host is unreachable");
    };

    live.onclose = (event) => {
      socket.current = null;
      watch(false);
      setLive(false);
      const kind = closeKind(event.code);
      setClosed(kind);
      setStatus(
        roomStatusAfterClose(
          kind,
          silenced
            ? // Named: the phone's own kill is owed the same truth as a dead room.
              pongLane
              ? "the room stopped answering - let go of the socket"
              : "no bytes from the room for 90s - let go of the socket"
            : null,
        ),
      );
      // An ended agent room gets `end room`'s mark so a startup agent will not recreate it; a shell is another room.
      if (kind === "ended" && mode !== "shell") markRoomEnded(attachedTo.project, attachedTo.name);
      const waiting = pending.current;
      const said = closeSentence(event);
      setError((previous) =>
        waiting
          ? `the photo is saved at ${waiting.path} but the room detached before it could be typed - reattach to deliver it`
          : errorAfterClose(previous, said, reachedOpen),
      );
    };

    // One SGR wheel notch; with no mouse lane the bytes would be text in claude's box, so xterm scrolls locally.
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

    // xterm makes no pan gesture under mouse tracking, so a pan is measured here and paid out in wheel notches.
    let panFrom: number | null = null;
    let panRest = 0;
    const rowsElement = () =>
      host.current?.querySelector(".xterm-rows") as HTMLElement | null;
    const cellHeight = () => {
      const rows = rowsElement();
      const measured = rows && xterm.rows ? rows.clientHeight / xterm.rows : 0;
      return measured > 0 ? measured : 14;
    };
    /** The cell under the finger: tmux reads it to pick the pane, so a split room scrolls the half touched. */
    const cellUnder = (clientX: number, clientY: number) => {
      const rows = rowsElement();
      if (!rows || !xterm.cols || !xterm.rows) return { column: 1, row: 1 };
      const box = rows.getBoundingClientRect();
      return {
        column: Math.floor((clientX - box.left) / (box.width / xterm.cols)) + 1,
        row: Math.floor((clientY - box.top) / (box.height / xterm.rows)) + 1,
      };
    };
    // The forged shift-drag: preventDefault on touchstart so no synthetic mouse events; mousedown at the element so
    // both services take the shiftKey branch; move and up at document, or MouseService leaks drag reports to tmux.
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
        /* A second mousedown clears the selection, so a stray touchstart mid-drag is swallowed. */
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
      // No tap opens a keyboard into the room (mobile IME types what was not typed); armed typing mode survives a tap.
      if (event.touches.length === 1 && !typingOn.current) allowKeyboard(false);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (selectingRef.current) {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        // A move after a cancelled gesture would extend a range xterm has finished.
        if (!drag.current.dragging) return;
        forge(document, "mousemove", touch);
        readSelection();
        return;
      }
      if (panFrom === null || event.touches.length !== 1) return;
      // One knob, scaled once here so both lanes agree; `LINES_PER_NOTCH` mirrors tmux and is never scaled itself.
      const factor = speed.current / SCROLL_NEUTRAL;
      const perNotch = (cellHeight() * LINES_PER_NOTCH) / (PAN_ACCELERATION * factor);
      const travelled = event.touches[0].clientY - panFrom + panRest;
      const notches = Math.trunc(travelled / perNotch);
      if (notches === 0) return;
      // Keep the remainder, or a slow drag scrolls nothing at all.
      panRest = travelled - notches * perNotch;
      panFrom = event.touches[0].clientY;
      const at = cellUnder(event.touches[0].clientX, event.touches[0].clientY);
      wheel(notches > 0 ? -Math.abs(notches) : Math.abs(notches), at.column, at.row);
      event.preventDefault();
    };
    /* A cancel still forges the mouseup: finishing xterm's range beats abandoning it half-open. */
    const endGesture = (event: TouchEvent) => {
      if (selectingRef.current) {
        const p = drag.current;
        if (!p.dragging) return;
        const touch = event.changedTouches[0];
        // changedTouches: the lifted finger is gone from `touches`, and a mouseup at 0,0 collapses the range.
        if (touch) {
          event.preventDefault();
          forge(document, "mouseup", touch);
        }
        p.dragging = false;
        readSelection();
        // A fit held back during the drag is paid now; the observer will not fire again by itself.
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
    // Firefox Android fires the synthetic click anyway (Bugzilla 1016480), so it is stopped in the capture phase.
    const swallowClick = (event: MouseEvent) => {
      if (!selectingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Suppresses Firefox Android's long-press (Bugzilla 1481923), which a slow drag triggers.
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

    const typed = xterm.onData((bytes) => {
      // xterm's composition finalizer can fire an empty string; it is not a keystroke.
      if (!bytes) return;
      if (!write(throughMods(bytes))) setError(DETACHED);
    });
    // Back in view, back on the wire: the photo picker backgrounds the PWA and the platform closes the socket.
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        watch(false);
        return;
      }
      const open = socket.current;
      // The reconnect lane decides when a socket opens; bumping `attempt` here too threw away handshakes in flight.
      if (!open || open.readyState !== WebSocket.OPEN) return;
      // A fresh look starts a fresh clock: pocket time is not silence, and would kill a healthy room.
      lastRx = Date.now();
      if (pongLane) {
        lastPong = Date.now();
        ping();
      }
      watch(true);
      // Re-state the size on every return: a pty resized from the host side fires no observer here, and the phone clips.
      try {
        fit.fit();
      } catch {
        return;
      }
      sendResize();
    };
    document.addEventListener("visibilitychange", onVisible);

    let settle = 0;
    const fitAndTell = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      sendResize();
    };
    const observer = new ResizeObserver(() => {
      /* A fit mid-drag drops the selection, so a drag holds the fit and it is paid on lift. */
      if (drag.current.dragging) {
        drag.current.heldFit = true;
        return;
      }
      // Trailing, never leading: declare the size the box came to rest at.
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
      window.clearTimeout(settle);
      watch(false);
      fitRef.current = null;
      resizeRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      observer.disconnect();
      typed.dispose();
      links.dispose();
      // Close first, then dispose: the close is the detach and must go out while the socket exists.
      live.onclose = null;
      live.close();
      socket.current = null;
      xterm.dispose();
      term.current = null;
    };
  }, [attachedTo, mode, opener, refusal, write, attempt, throughMods, allowKeyboard, helperField]);

  // The reconnect lane, the only place that opens sockets: a ladder because every attach repaints the desk, only while
  // visible, reset by a fresh look. Background panes recover on purpose; the ladder bounds their cost.
  useEffect(() => {
    // No retry when attached, read-only, refused or ended: `new-session -A` would build an empty room under the old name.
    if (live || refusal || closeIsFinal(closed)) {
      setReconnecting(false);
      return;
    }
    let timer = 0;
    const armIn = (wait: number) => {
      window.clearTimeout(timer);
      setReconnecting(true);
      timer = window.setTimeout(() => {
        const open = socket.current;
        // A handshake in flight is not a reason to start a second one; that abandons it and bills the desk twice.
        if (open && open.readyState === WebSocket.CONNECTING) {
          armIn(HANDSHAKE_POLL_MS);
          return;
        }
        // It opened while the rung ticked: `live` state lags the socket, so read the socket itself.
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
      retries.current = 0;
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `attempt` re-arms the next rung; the counter is a ref so this effect is the only thing that reattaches.
  }, [live, refusal, attempt, closed]);

  // Native listeners: React's `onBeforeInput` can carry a TextEvent with no `inputType`, which delivered zero bytes.
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

  // The belt is lifted by the height the keyboard hides from the visual viewport (zero where the layout resizes).
  const belt = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const strip = belt.current;
      if (strip) strip.style.transform = hidden > 0 ? `translateY(-${hidden}px)` : "";

      // The room slides rather than shrinks (a shrink resizes the pty on every keyboard), measured against the lifted
      // belt's rendered top; `cellUnder` reads the transformed rect, so taps stay aimed.
      const room = host.current;
      const box = room?.parentElement;
      if (room && box && strip) {
        room.style.transform = "";
        const beltTop = strip.getBoundingClientRect().top;
        const covered = Math.max(0, box.getBoundingClientRect().bottom - beltTop);
        // Any keyboard now hides the bottom rows, where the prompt lives; with none, `covered` is zero.
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
    // `typing` stays a dependency: the belt's height changes with the mode and no visualViewport event fires.
  }, [typing]);

  /** What to watch for on screen: the line's tail with whitespace removed, since a grid wraps and pads lines. */
  const landmark = useCallback((literal: string): string => {
    const bare = literal.replace(/\s+/g, "");
    return bare.length < LANDMARK_MIN ? "" : bare.slice(-LANDMARK_MAX);
  }, []);

  const showings = useCallback((mark: string): number => {
    const xterm = term.current;
    if (!xterm || !mark) return 0;
    const buffer = xterm.buffer.active;
    // The visible screen and one screen above it: anything older cannot be this send's echo.
    const from = Math.max(0, buffer.length - xterm.rows * 2);
    let shown = "";
    for (let row = from; row < buffer.length; row += 1) {
      shown += buffer.getLine(row)?.translateToString(true) ?? "";
    }
    // Rows join with no separator so a wrapped line is one string, and the haystack loses whitespace like the mark.
    return shown.replace(/\s+/g, "").split(mark).length - 1;
  }, []);

  /** Submit once the room has shown the line, or at the ceiling: never submitting would be the worse failure. */
  const submitOnceLanded = useCallback(
    (mark: string, before: number) => {
      let waited = 0;
      const submit = () => {
        // The CR can fail alone, leaving the line typed but unsubmitted: say exactly that.
        if (!write("\r")) {
          setError("the line was typed but not submitted - the room detached mid-send. Reattach and press ⏎.");
        }
      };
      if (!mark) {
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

  // A bracketed paste, then CR: Ink treats a CR inside a chunk as pasted text, and the mode read is tmux's (it strips
  // markers for panes that did not ask). The CR still waits for the line to show: the far end can act on it early.
  function send() {
    const literal = text;
    if (!literal || refusal) return;
    const bracketed = term.current?.modes.bracketedPasteMode ?? false;
    const staged = bracketed ? `\x1b[200~${literal}\x1b[201~` : literal;
    // Counted before the write, so a line already on screen cannot satisfy the wait with its older copy.
    const mark = landmark(literal);
    const before = showings(mark);
    // Write first, clear second: the text is the operator's until the bytes are known to have gone.
    if (!write(staged)) {
      setError(DETACHED);
      return;
    }
    setText("");
    submitOnceLanded(mark, before);
  }

  /** The live `send` for the native listener, which registers once. */
  const sendNow = useRef(send);
  useEffect(() => {
    sendNow.current = send;
  });

  // One send per Enter: keydown and beforeinput can both announce it; the flag clears on the next tick.
  const announced = useRef(false);
  const submitOnce = useCallback(() => {
    if (announced.current) return;
    announced.current = true;
    window.setTimeout(() => {
      announced.current = false;
    }, 0);
    sendNow.current();
  }, []);

  // Gboard with prediction sends Enter's keydown as 229/`Unidentified`; the intent is only in `beforeinput`.
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
    // `typing` is load-bearing: the textarea unmounts on arm and a new one mounts on disarm.
  }, [submitOnce, typing]);

  /** Zoom on the live terminal, then re-fit and tell the room: a client must never render a geometry it did not declare. */
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
      return;
    }
    resizeRef.current?.();
  }

  // Height follows content; `auto` first, or scrollHeight reports the old height and the box never shrinks.
  useEffect(() => {
    const field = compose.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [text, typing]);

  // Copy runs synchronously inside the tap: plain http is not a secure context, so it is `execCommand`, spent on
  // yield. Only a resolved clipboard promise is confirmed; otherwise the takeout panel shows the text.
  function copySelection() {
    const text = term.current?.getSelection() ?? "";
    if (!text) {
      setCopyNote("nothing selected - drag across a line first");
      return;
    }
    void copyThrough(text).then((lane) => {
      const report = copyReport(lane, `${text.length} characters`);
      setCopyNote(report.note);
      if (report.showText) setTakeout({ kind: "text", text, note: report.note });
    });
  }

  /** The links door: one scan of the whole buffer per tap, into an overlay, so nothing resizes and no selection drops. */
  function openLinks() {
    const xterm = term.current;
    if (!xterm) return;
    const buffer = xterm.buffer.active;
    const rows = readRows(buffer, 0, buffer.length);
    setLinkNotes({});
    setTakeout({ kind: "links", urls: recentUrls(findLinks(rows, xterm.cols), PANEL_URLS), rows: rows.length });
  }

  function copyLink(url: string) {
    void copyThrough(url).then((lane) => {
      const { note } = copyReport(lane, "the link");
      setLinkNotes((was) => ({ ...was, [url]: note }));
    });
  }

  function selectAll(event: FocusEvent<HTMLTextAreaElement>) {
    event.currentTarget.select();
  }

  function press(bytes: string) {
    // Scrolled directly: `input()` would route chip bytes through onData and apply the stickies twice.
    term.current?.scrollToBottom();
    if (!write(bytes)) setError(DETACHED);
  }

  // Arms xterm's own textarea, not a mirror field: a mirror cannot know when tmux rewrites the line.
  const toggleTyping = useCallback(() => {
    // The ref is the source, not a `setTyping` updater: React may replay updaters, which flipped the flag back.
    const now = !typingOn.current;
    typingOn.current = now;
    armedAt.current = Date.now();
    setTyping(now);
    allowKeyboard(now);
    if (now) term.current?.focus();
    else helperField()?.blur();
    // Told last: the textarea unmounts on arm (no blur), and the focus move above fires its onBlur(false) first.
    onComposeFocus?.(now);
  }, [allowKeyboard, helperField, onComposeFocus]);

  /** A chip through the stickies: only arrows combine (Ctrl+arrow is word-jump); the rest are final bytes. */
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

  // Upload every file, then type every path once via `deliveryText`, never with Enter; failures are named.
  async function sendPhotos(files: File[]) {
    setSending(true);
    setError(null);
    const paths: string[] = [];
    const failed: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setStatus(files.length > 1 ? `uploading ${index + 1}/${files.length} · ${file.name}…` : `uploading ${file.name}…`);
        try {
          paths.push(await uploadImage(file));
        } catch (cause) {
          failed.push(`${file.name}: ${cause instanceof HostError ? cause.message : String(cause)}`);
        }
      }
      if (paths.length === 0) {
        setError(`photo not sent: ${failed.join("; ")}`);
        setStatus(`attached · ${roomLabel}`);
        return;
      }
      const path = paths.join(" ");
      const bytes = deliveryText(paths);
      if (failed.length > 0) {
        setError(`${paths.length} of ${files.length} sent - not sent: ${failed.join("; ")}`);
      }
      if (write(bytes)) {
        setStatus(`delivered · ${path}`);
      } else {
        // The picker backgrounds the PWA and the socket closes; the file is on disk, so queue it and reattach.
        pending.current = { bytes, path };
        setStatus(`saved · ${path}`);
        setError(`the photo is saved at ${path} but the room detached before it could be typed - reattaching to deliver it`);
        reattachNow();
      }
    } finally {
      setSending(false);
      // Clear the input, or picking the SAME photo twice fires no change event.
      if (picker.current) picker.current.value = "";
    }
  }

  const dead = refusal || live ? null : deadFace({ lane: "room", label: roomLabel, closed, opened, reconnecting });

  return (
    <section className={`baud-phone-term ${full ? "baud-phone-term-full" : ""}`}>

      {error ? <p className="baud-phone-error">{error}</p> : null}

      {status.startsWith("attached ·") ? null : (
        <p className="baud-phone-term-status">{status}</p>
      )}


      {refusal ? (
        <p className="baud-phone-term-refused">
          read-only session — {refusal}. An attached room is a shell prompt, so it needs operate.
        </p>
      ) : null}

      <div className="baud-phone-term-screen">
        <div ref={host} className="baud-phone-term-host" />
        {/* A dead room must look dead: xterm keeps painting the last frame, so the overlay sits on the grid. */}
        {dead ? (
          <div className="baud-phone-term-dead">
            <p className="baud-phone-term-dead-word">{dead.word}</p>
            <p className="baud-phone-term-dead-why">{dead.why}</p>
            {dead.retry ? (
              <button type="button" className="baud-phone-term-reattach" onClick={reattachNow}>
                {dead.retry}
              </button>
            ) : null}
            {dead.ladder ? <p className="baud-phone-term-dead-why">{dead.ladder}</p> : null}
          </div>
        ) : null}
        <button
          type="button"
          className="baud-phone-term-full-toggle"
          title={full ? "leave fullscreen - the layout underneath is unchanged" : "fill the screen with the room - nothing underneath moves, and the room stays attached"}
          onClick={() => setFull((on) => !on)}
        >
          {full ? "⤡" : "⤢"}
        </button>
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
          {/* Absolutely positioned over the screen: a layout shift under a live drag would drop the selection. */}
          <button
            type="button"
            className={`baud-phone-term-viewbtn ${selecting ? "baud-phone-term-viewbtn-armed" : ""}`}
            disabled={Boolean(refusal)}
            aria-pressed={selecting}
            aria-label={selecting ? "stop selecting text" : "select text by dragging"}
            title={
              refusal ??
              "select text by dragging - xterm selects locally instead of forwarding to tmux. While armed the room takes no taps."
            }
            onClick={() => {
              setSelecting((on) => {
                const next = !on;
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
          <button
            type="button"
            className="baud-phone-term-viewbtn"
            disabled={Boolean(refusal)}
            aria-label="list the links in this room"
            title={refusal ?? `the room's links - the last ${PANEL_URLS} URLs in the scrollback, each with open and copy`}
            onClick={openLinks}
          >
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
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
          {/* HoldButton keeps focus (arrows are pressed with the keyboard up); `pressChip` applies latched mods. */}
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
        {/* The takeout overlay: nothing resizes; its fields are readOnly + inputMode none so copying raises no keyboard. */}
        {takeout ? (
          <div
            className="baud-phone-term-takeout"
            role="dialog"
            aria-label={takeout.kind === "links" ? "links in this room" : "the selected text"}
          >
            <div className="baud-phone-term-takeout-head">
              <p className="baud-phone-term-takeout-title">
                {takeout.kind === "links" ? "links in this room" : "copy by hand"}
              </p>
              <button type="button" className="baud-phone-term-takeout-key" onClick={() => setTakeout(null)}>
                close
              </button>
            </div>
            {takeout.kind === "text" ? (
              <>
                <p className="baud-phone-term-takeout-note">{takeout.note}</p>
                <textarea
                  className="baud-phone-term-takeout-field baud-phone-term-takeout-text"
                  readOnly
                  inputMode="none"
                  aria-label="the selected text"
                  value={takeout.text}
                  onFocus={selectAll}
                />
              </>
            ) : takeout.urls.length === 0 ? (
              <p className="baud-phone-term-takeout-note">
                no links in this room - read {takeout.rows} rows of scrollback and found no http(s) URL.
              </p>
            ) : (
              <ul className="baud-phone-term-takeout-list">
                {takeout.urls.map((url) => (
                  <li key={url} className="baud-phone-term-takeout-row">
                    {linkNotes[url] ? <p className="baud-phone-term-takeout-note">{linkNotes[url]}</p> : null}
                    <textarea
                      className="baud-phone-term-takeout-field"
                      readOnly
                      inputMode="none"
                      rows={2}
                      aria-label="the link"
                      value={url}
                      onFocus={selectAll}
                    />
                    <div className="baud-phone-term-takeout-keys">
                      {/* A real anchor: the navigation Android honours most reliably from an installed PWA. */}
                      <a className="baud-phone-term-takeout-key" href={url} target="_blank" rel="noopener noreferrer">
                        open
                      </a>
                      <button type="button" className="baud-phone-term-takeout-key" onClick={() => copyLink(url)}>
                        copy
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div ref={belt} className="baud-phone-term-belt">
        {selecting ? (
          <div className="baud-phone-term-selrow">
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
        {/* One transparent pixel, not display:none: an unrendered field cannot take focus. */}
        <input
          ref={proxy}
          className="baud-phone-term-proxy"
          type="text"
          // A label, not aria-hidden: a focused aria-hidden element is a contradiction the platform may resolve badly.
          aria-label="terminal keyboard input"
          // Uncontrolled, not readOnly: readOnly fires no `beforeinput`; a controlled value fights the clearing.
          defaultValue=""
          tabIndex={-1}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          // `beforeinput` and `input` are attached natively in an effect; React's `onBeforeInput` is a different event.
        />
        <nav className="baud-phone-term-keys">
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
                  // Arming opens the keyboard against the chip row's field (this tap is the gesture); disarming shuts it.
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

        {/* Outside the slot, which unmounts on arm mid-upload. No `capture`: it would lock out screenshots. */}
        <input
          ref={picker}
          className="baud-phone-term-picker"
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) void sendPhotos(files);
          }}
        />
        <div className="baud-phone-term-input">
        {typing ? (
        <button
          type="button"
          className="baud-phone-term-typebar baud-phone-term-typebar-on"
          aria-pressed
          title="typing goes to the room - tap to stop, put the keyboard away and get the baud box back"
          // No focus theft: a focused button can land after the field's focus and blur it the instant it opened.
          onPointerDown={(event) => event.preventDefault()}
          onClick={toggleTyping}
        >
          typing → the room · raw keys · tap to stop
        </button>
        ) : (
        <>
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
        {/* Busy is a class and the title, never a glyph swap: an icon-only button changing width twitches the input. */}
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
          // Flattened on the way in: send() writes one call, so a pasted \n would submit lines nobody sent.
          onChange={(event) => setText(event.target.value.replace(/[\r\n]+/g, " "))}
          onFocus={() => onComposeFocus?.(true)}
          onBlur={() => onComposeFocus?.(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Or the textarea inserts the newline and sends; it also suppresses the duplicate `beforeinput`.
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
          // The same path as Enter, to the byte, so they cannot drift; `submitOnce` also stops a double tap sending twice.
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
