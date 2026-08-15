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

import { useCallback, useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { deliveryText } from "../deliver";
import { openRoomSocket, uploadImage } from "../host";
import { HostError } from "../host/transport.http";
import type { BranchStatus } from "../types";
import { type LaunchMode, launchCommand, typeOnAttach } from "./rooms";
import { type Scope, scopeRefusal } from "./verbs";

/**
 * The key bar - the keys a thumb needs and a soft keyboard hides.
 *
 * REAL CONTROL BYTES, not key names. The repaint design sent `"C-c"` to a
 * backend that interpreted it, and the interpreting was the whole reason that
 * path needed an allowlist. Here each button writes the exact byte a keyboard
 * writes, into a stream that interprets nothing - so there is no allowlist to
 * enforce and nothing to get wrong. `\x1b[A` is what the Up arrow puts on the
 * wire; the room decides what it means, as it does for the desk.
 */
const KEYS: ReadonlyArray<{ bytes: string; label: string; title: string }> = [
  { bytes: "\x03", label: "^C", title: "interrupt - the byte Ctrl+C sends" },
  { bytes: "\x1b", label: "esc", title: "escape - back out of a prompt" },
  // NAMED FOR WHAT THEY ARE, after a thumb read them as scroll and got a
  // stale prompt stuffed into the room's input box instead. They stay arrow
  // KEYS - claude's menus are navigated with them and a phone with no arrows
  // cannot answer a permission prompt - but they no longer wear the label of
  // the thing beside them.
  { bytes: "\x1b[A", label: "↑key", title: "the Up ARROW key - recalls the last prompt, moves a menu. Does NOT scroll." },
  { bytes: "\x1b[B", label: "↓key", title: "the Down ARROW key - forward through history, moves a menu. Does NOT scroll." },
  { bytes: "\t", label: "tab", title: "complete" },
  { bytes: "\r", label: "⏎", title: "submit what is on the line" },
];

/**
 * Scrolling the ROOM, which is a different act from pressing a key.
 *
 * Claude Code is a full-screen TUI: there is no local scrollback to swipe,
 * because the history lives in tmux, not in this xterm. So scrolling means
 * sending the room a WHEEL event and letting tmux's own copy-mode do it -
 * `mouse on` (set when the room is opened) is what makes that lane exist.
 */
const SCROLL: ReadonlyArray<{ notches: number; label: string; title: string }> = [
  { notches: -1, label: "▲", title: "scroll the room back - the same as a wheel up" },
  { notches: 1, label: "▼", title: "scroll the room forward" },
];

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
 */
const PAN_ACCELERATION = 3;

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
  mode: LaunchMode;
  scope: Scope;
  onClose: () => void;
}

export default function TerminalSheet({ branch, mode, scope, onClose }: TerminalSheetProps) {
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
  const host = useRef<HTMLDivElement | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const term = useRef<XTerm | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
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
  /** The live wheel writer. It closes over the terminal, which only exists
   *  inside the attach effect, so the chips reach it through here. */
  const wheelRef = useRef<((notches: number) => boolean) | null>(null);
  const refusal = scopeRefusal(scope);

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
      fontSize: 11,
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

    let live: WebSocket;
    try {
      live = openRoomSocket(attachedTo.name, attachedTo.project);
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
      setStatus(`attached · ${attachedTo.name}`);
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
      if (!launched.current && typeOnAttach(attachedTo)) {
        launched.current = true;
        write(`${launchCommand(attachedTo, mode)}\n`);
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
      if (event.data instanceof ArrayBuffer) xterm.write(new Uint8Array(event.data));
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
    wheelRef.current = wheel;

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
    const onTouchStart = (event: TouchEvent) => {
      panFrom = event.touches.length === 1 ? event.touches[0].clientY : null;
      panRest = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (panFrom === null || event.touches.length !== 1) return;
      const perNotch = (cellHeight() * LINES_PER_NOTCH) / PAN_ACCELERATION;
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
    const onTouchEnd = () => {
      panFrom = null;
      panRest = 0;
    };
    const screen = host.current;
    // Not passive: a pan that scrolls the room must not ALSO drag the page.
    screen.addEventListener("touchstart", onTouchStart, { passive: false });
    screen.addEventListener("touchmove", onTouchMove, { passive: false });
    screen.addEventListener("touchend", onTouchEnd);
    screen.addEventListener("touchcancel", onTouchEnd);

    // DIRECT TYPING IS THE PATH HE REACHES FOR FIRST, and it is untouched here:
    // same function, same bytes, nothing added between the keyboard and the
    // room. The only difference is that a keystroke dropped on a dead socket now
    // says so - and it needs saying most on this path, because the terminal
    // echoes nothing back either way, so silence is exactly what a working room
    // looks like while you type into a closed one.
    const typed = xterm.onData((bytes) => {
      if (!write(bytes)) setError(DETACHED);
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
      screen.removeEventListener("touchcancel", onTouchEnd);
      wheelRef.current = null;
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
  }, [attachedTo, mode, refusal, write, attempt]);

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

  /** A key chip. Same promise as every other control, so the same audit. */
  function press(bytes: string) {
    if (!write(bytes)) setError(DETACHED);
  }

  /** A scroll chip - the same notch a pan pays out, without the gesture. */
  function scroll(notches: number) {
    const wheel = wheelRef.current;
    if (!wheel) return;
    // A room with no mouse lane scrolls this xterm's own buffer instead, which
    // is a real answer for a shell and a useless one for a full-screen TUI. Say
    // so rather than let a dead-feeling button read as breakage.
    if (!wheel(notches)) {
      setError(
        "this room has no scroll lane - it was opened before BAUD set `mouse on`. Reopen it from the card and the wheel will work.",
      );
    }
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
      setStatus(`attached · ${attachedTo.name}`);
    } finally {
      setSending(false);
      // Clear the input, or picking the SAME photo twice fires no change event.
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <section className="baud-phone-term">
      <header className="baud-phone-term-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ detach
        </button>
        <span className="baud-phone-term-title">{attachedTo.name}</span>
        <span className="baud-phone-term-geom">{status}</span>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}

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
          reattach to {attachedTo.name}
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
      </div>

      <nav className="baud-phone-term-keys">
        {/* Scroll first: it is the thing a thumb reaches for, and putting it
            left of the arrow keys is half of why the arrows stop being a
            trap. The other half is that they are now labelled `↑key`. */}
        {SCROLL.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="baud-phone-term-key baud-phone-term-scroll"
            disabled={Boolean(refusal)}
            title={refusal ?? chip.title}
            onClick={() => scroll(chip.notches)}
          >
            {chip.label}
          </button>
        ))}
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            className="baud-phone-term-key"
            disabled={Boolean(refusal)}
            title={refusal ?? key.title}
            onClick={() => press(key.bytes)}
          >
            {key.label}
          </button>
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
        <button
          type="button"
          className="baud-phone-term-photo"
          disabled={Boolean(refusal) || sending}
          title={refusal ?? "attach a photo - its path is typed into your line, not sent"}
          onClick={() => picker.current?.click()}
        >
          {sending ? "…" : "photo"}
        </button>
        <input
          className="baud-phone-term-field"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={refusal ? "read-only" : "type a line…"}
          disabled={Boolean(refusal)}
          title={refusal ?? "typed into the room, then submitted - two separate bytes"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
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
    </section>
  );
}
