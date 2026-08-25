/**
 * The phone's watch: a tier-0 monitor pane in the stage (desktop m9, ported).
 *
 * LIVE OUTPUT, NO KEYBOARD. The desktop holds the no-stdin line twice - xterm's
 * `disableStdin` in the pane and `pty_write`'s refusal in the backend, "the one
 * that counts". This sheet holds the same line the same way: `disableStdin`
 * here, and @api's read-only session underneath, whose `write` refuses with a
 * sentence and closes the socket. A window, not a seat.
 *
 * NOT TMUX-BACKED, deliberately - the opposite call from the shell lane, for
 * the opposite reason. A shell holds work, so it must survive its client; a
 * watch holds nothing, so when this sheet unmounts the observer dies and
 * nothing was lost. Reopening the door starts a fresh `drone @prax monitor run`
 * exactly as the desktop's toggle does on re-click.
 *
 * Rides the read scope: watching is observation, and observation is what the
 * read token IS - the same split that keeps every /v1 read off the operate
 * scope. The socket is the room lane's own (`kind=watch`), so auth, close
 * sentences and the resize control frame are all inherited, not reimplemented.
 */

import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { openRoomSocket } from "../host";
import { HostError } from "../host/transport.http";
import type { BranchStatus } from "../types";
import { LINES_PER_NOTCH, MAX_FONT, MIN_FONT, PAN_ACCELERATION } from "./TerminalSheet";

/** The watch opens at the terminal sheet's OLD default - a monitor is read at
 *  a glance, not worked in, so it keeps the legible 10 rather than following
 *  the terminal's fully-zoomed-out 7. The zoom chips travel the same range as
 *  the terminal's, imported so the two faces cannot drift apart. */
const FONT_SIZE = 10;

/** The room lane's close-code contract, unchanged: 1008 is fixable and the
 *  caller's, 1011 is the host's. Anything else is a plain disconnect. */
function closeSentence(event: CloseEvent): string | null {
  if (event.code === 1008) return event.reason || "the watch refused this request";
  if (event.code === 1011) return event.reason || "the host could not open the watch";
  return null;
}

interface MonitorSheetProps {
  /** Whose activity to watch - the card the door was pressed on. */
  branch: BranchStatus;
}

export default function MonitorSheet({ branch }: MonitorSheetProps) {
  /** Frozen at mount for the same reason TerminalSheet freezes its card: the
   *  poll hands down new objects every ten seconds, and a watch re-spawning
   *  per poll would be the exact per-poll leak the room lane killed. */
  const watching = useRef(branch).current;
  const host = useRef<HTMLDivElement | null>(null);
  /** Where xterm actually opens - kept free of React children so xterm's own
   *  appended element and React's reconciliation never manage one parent. */
  const mount = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  /** Bumped by the rewatch button - the effect's re-run door. */
  const [attempt, setAttempt] = useState(0);
  /** Fullscreen and zoom - TerminalSheet's view controls, ported (Patrick,
   *  2026-08-24: "on watch there is no zoom or full screen"). Only the VIEW
   *  half comes over: the byte-writing chips stay off a watch by ruling -
   *  watch, prax and commons are no-keyboard by design. */
  const [full, setFull] = useState(false);
  const [font, setFont] = useState(FONT_SIZE);
  /** Select-and-copy, TerminalSheet's lane ported (Patrick, 2026-08-24: "I
   *  need copy in watch and prax that quite important") - a monitor is where
   *  errors are READ, so its text has to be liftable. Same forged shift-drag,
   *  same synchronous execCommand copy; what does NOT come over is anything
   *  that writes a byte to the watch. */
  const [selecting, setSelecting] = useState(false);
  /** The armed flag as the touch listeners see it - they are bound once per
   *  watch and must not be torn down and rebuilt to learn about a chip. */
  const selectingRef = useRef(false);
  selectingRef.current = selecting;
  const [selText, setSelText] = useState("");
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /** `dragging` gates the forged mouse events and holds the ResizeObserver's
   *  fit (a fit mid-drag drops the selection - TerminalSheet's proven killer);
   *  `heldFit` is the receipt that says one is owed on lift. */
  const drag = useRef({ dragging: false, heldFit: false });
  /** What the NEXT effect run creates its xterm at - a ref, not the state,
   *  so zooming never enters the effect's dependencies. A font in the deps
   *  would tear down the socket per press: a remount hiding inside a font
   *  change, the exact bug TerminalSheet's zoom comment warns about. */
  const fontNow = useRef(FONT_SIZE);
  /** The live instance's doors, for zoom() below - set by the effect. */
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);

  /** TerminalSheet's zoom(), same order and for the same reason: set the
   *  size, re-measure, then TELL the watch process - skipping the last step
   *  leaves a client rendering a geometry it never declared. */
  function zoom(step: number) {
    const next = Math.min(MAX_FONT, Math.max(MIN_FONT, font + step));
    if (next === font) return;
    setFont(next);
    fontNow.current = next;
    const xterm = termRef.current;
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

  /**
   * TerminalSheet's copy lane, verbatim: EVERY STEP RUNS SYNCHRONOUSLY INSIDE
   * THE TAP. `navigator.clipboard` does not exist here - the host serves plain
   * http on a tailnet IP, not a secure context - so the lane is the legacy
   * `execCommand`, spent the instant the handler yields. The scratch field is
   * readOnly with inputMode none so focusing it cannot summon a keyboard over
   * the thing the operator just selected.
   */
  function copySelection() {
    const text = termRef.current?.getSelection() ?? "";
    if (!text) {
      setCopyNote("nothing selected - drag across a line first");
      return;
    }
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.readOnly = true;
    scratch.inputMode = "none";
    // Off-screen, but NOT hidden: display:none makes the field unselectable
    // and the copy silently copies nothing.
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
        ? `copied - ${text.length} chars`
        : "execCommand refused - the legacy lane is closed here, so copy needs another route",
    );
  }

  useEffect(() => {
    const screen = host.current;
    if (!screen || !mount.current) return;
    /** The gesture surface - the xterm-only mount, NOT the screen div. The
     *  screen also holds the corner buttons, and an armed selection branch
     *  preventDefaults every touch it sees: listeners on the screen would eat
     *  the very taps that disarm and zoom. On the mount the buttons are
     *  SIBLINGS (TerminalSheet's exact layout - its handlers ride its
     *  xterm-only host div), so their taps never pass through here at all. */
    const surface = mount.current;
    setError(null);

    const xterm = new XTerm({
      convertEol: false,
      fontSize: fontNow.current,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace',
      // No cursor and no keyboard - the pane-side half of tier-0. The half
      // that counts is @api's read-only session refusing the bytes.
      cursorBlink: false,
      disableStdin: true,
      scrollback: 2_000,
      theme: { background: "#070a09", foreground: "#d6e2dc" },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(mount.current);
    fit.fit();
    termRef.current = xterm;
    fitRef.current = fit;

    /**
     * A finger pan IS the scroll gesture on a phone (TerminalSheet's pan
     * handler, ported). Simpler here: this watch has no room to forward a
     * wheel event to, so a pan always takes TerminalSheet's mouse-lane-off
     * branch - xterm's own local scrollback, which is real here (`scrollback:
     * 2_000` above) rather than a fallback for a room with no mouse. No
     * `cellUnder` targeting either - there is no pane to aim at.
     */
    let panFrom: number | null = null;
    let panRest = 0;
    const cellHeight = () => {
      const rows = screen.querySelector(".xterm-rows") as HTMLElement | null;
      const measured = rows && xterm.rows ? rows.clientHeight / xterm.rows : 0;
      return measured > 0 ? measured : 14;
    };
    /* THE FORGED DRAG, TerminalSheet's rules kept - preventDefault on
     * touchstart so the browser synthesises no mouse events of its own;
     * mousedown AT THE TERMINAL ELEMENT; mousemove and mouseup AT DOCUMENT,
     * where SelectionService binds them for the gesture - with ONE fork
     * TerminalSheet never needed: shift ONLY WHEN AN APPLICATION OWNS THE
     * MOUSE. Shift is xterm's FORCE-selection key, and force only STARTS a
     * selection while SelectionService is disabled (mouse tracking active -
     * every tmux room, which is why TerminalSheet's unconditional shift
     * works there). With tracking off - this watch's whole life, a raw pty
     * under `drone @prax monitor run`, no tmux - the service stays ENABLED,
     * and an enabled service reads shift+mousedown as EXTEND the current
     * selection: `_handleIncrementalClick`, a literal no-op when nothing is
     * selected yet. Unconditional shift here meant every drag extended
     * nothing - the "armed but selects nothing" bug. Same fork, same door,
     * as TerminalSheet's own wheel(): `modes.mouseTrackingMode`. */
    const forge = (
      target: EventTarget,
      type: "mousedown" | "mousemove" | "mouseup",
      touch: Touch,
    ) => {
      target.dispatchEvent(
        new MouseEvent(type, {
          clientX: touch.clientX,
          clientY: touch.clientY,
          screenX: touch.screenX,
          screenY: touch.screenY,
          shiftKey: xterm.modes.mouseTrackingMode !== "none",
          button: 0,
          buttons: 1,
          detail: 1,
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    };
    /* Only touches React state when the reading actually CHANGED - a drag
     * fires touchmove tens of times a second. */
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
         * new range on every one. A stray second finger is swallowed. */
        if (p.dragging) {
          readSelection();
          return;
        }
        p.dragging = true;
        p.heldFit = false;
        const target = surface.querySelector(".xterm-screen") ?? surface;
        forge(target, "mousedown", touch);
        return;
      }
      panFrom = event.touches.length === 1 ? event.touches[0].clientY : null;
      panRest = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (selectingRef.current) {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        if (!drag.current.dragging) return;
        forge(document, "mousemove", touch);
        readSelection();
        return;
      }
      if (panFrom === null || event.touches.length !== 1) return;
      const perNotch = (cellHeight() * LINES_PER_NOTCH) / PAN_ACCELERATION;
      const travelled = event.touches[0].clientY - panFrom + panRest;
      const notches = Math.trunc(travelled / perNotch);
      if (notches === 0) return;
      // Keep the remainder - dropping it makes a slow drag scroll nothing.
      panRest = travelled - notches * perNotch;
      panFrom = event.touches[0].clientY;
      // Finger DOWN uncovers what came before, which is a wheel UP.
      xterm.scrollLines((notches > 0 ? -Math.abs(notches) : Math.abs(notches)) * LINES_PER_NOTCH);
      event.preventDefault();
    };
    const endGesture = (event: TouchEvent) => {
      if (selectingRef.current) {
        const p = drag.current;
        if (!p.dragging) return;
        // changedTouches, not touches - the lifted finger is no longer in
        // `touches`, and a mouseup at 0,0 would collapse the range.
        const touch = event.changedTouches[0];
        if (touch) {
          event.preventDefault();
          forge(document, "mouseup", touch);
        }
        p.dragging = false;
        readSelection();
        // A fit held back during the drag is paid now.
        if (p.heldFit) {
          p.heldFit = false;
          try {
            fit.fit();
            resizeRef.current?.();
          } catch {
            // The sheet is closing. Not a failure.
          }
        }
        return;
      }
      panFrom = null;
      panRest = 0;
    };
    /* Firefox Android fires the synthetic click despite the preventDefaulted
     * touchstart (Bugzilla 1016480), at the ORIGINAL touch target - stopped in
     * capture before xterm can act on it. And contextmenu preventDefault is
     * the documented lane for suppressing its long-press over
     * user-select:none content (Bugzilla 1481923): a slow careful drag IS a
     * long press to the browser. */
    const swallowClick = (event: MouseEvent) => {
      if (!selectingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: Event) => {
      if (!selectingRef.current) return;
      event.preventDefault();
    };
    // Not passive: a pan that scrolls the watch must not ALSO drag the page.
    surface.addEventListener("touchstart", onTouchStart, { passive: false });
    surface.addEventListener("touchmove", onTouchMove, { passive: false });
    surface.addEventListener("touchend", endGesture, { passive: false });
    surface.addEventListener("touchcancel", endGesture, { passive: false });
    surface.addEventListener("click", swallowClick, true);
    surface.addEventListener("contextmenu", onContextMenu, { passive: false });

    let socket: WebSocket;
    try {
      socket = openRoomSocket(watching.name, watching.project, "watch");
    } catch (cause) {
      setError(cause instanceof HostError ? cause.message : String(cause));
      xterm.dispose();
      return;
    }
    // Bytes, not Blobs - decoding here would break UTF-8 split across chunks.
    socket.binaryType = "arraybuffer";

    /** The one control verb on the wire, same as every lane on this socket. */
    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const { cols, rows } = xterm;
      if (cols > 0 && rows > 0) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };
    resizeRef.current = sendResize;

    socket.onopen = () => {
      setLive(true);
      setError(null);
      // First frame is the size - the monitor draws at 80x24 until told.
      sendResize();
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) xterm.write(new Uint8Array(event.data));
    };
    socket.onerror = () => {
      setError("the watch refused this connection - the token was rejected, or the host is unreachable");
    };
    socket.onclose = (event) => {
      setLive(false);
      setError(closeSentence(event));
    };

    const observer = new ResizeObserver(() => {
      // A fit mid-drag drops the selection (TerminalSheet's proven killer),
      // so one owed during a drag is held and paid on lift.
      if (drag.current.dragging) {
        drag.current.heldFit = true;
        return;
      }
      fit.fit();
      sendResize();
    });
    observer.observe(screen);

    return () => {
      surface.removeEventListener("touchstart", onTouchStart);
      surface.removeEventListener("touchmove", onTouchMove);
      surface.removeEventListener("touchend", endGesture);
      surface.removeEventListener("touchcancel", endGesture);
      surface.removeEventListener("click", swallowClick, true);
      surface.removeEventListener("contextmenu", onContextMenu);
      observer.disconnect();
      termRef.current = null;
      fitRef.current = null;
      resizeRef.current = null;
      // Close FIRST, then dispose - the close is what ends the observer
      // process on the host, and it must go out while the socket exists.
      socket.onclose = null;
      socket.close();
      xterm.dispose();
    };
  }, [watching, attempt]);

  return (
    <section className={`baud-phone-term ${full ? "baud-phone-term-full" : ""}`}>
      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!live ? (
        <button type="button" className="baud-phone-term-reattach" onClick={() => setAttempt((n) => n + 1)}>
          watch {watching.name}
        </button>
      ) : null}
      {/* xterm opens into the inner host div; the buttons overlay the screen's
          corner. The screen is position:relative (phone.css), so the absolute
          classes the terminal sheet already owns land the same way here. */}
      <div ref={host} className="baud-phone-term-screen">
        <div ref={mount} className="baud-phone-term-host" />
        {/* Fullscreen: only a class on the section - the watch, its xterm and
            its socket are the same objects before and after, which is the
            entire requirement (TerminalSheet's toggle, verbatim). */}
        <button
          type="button"
          className="baud-phone-term-full-toggle"
          title={
            full
              ? "leave fullscreen - the layout underneath is unchanged"
              : "fill the screen with the watch - nothing underneath moves, and the watch stays live"
          }
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
              title={
                step < 0
                  ? `smaller type - buys columns, and the watch is told (now ${font}px)`
                  : `bigger type - costs columns, and the watch is told (now ${font}px)`
              }
              onClick={() => zoom(step)}
            >
              {step < 0 ? "A−" : "A+"}
            </button>
          ))}
          {/* The select toggle, TerminalSheet's I-beam: while armed the watch
              takes no pan - drags select locally instead. */}
          <button
            type="button"
            className={`baud-phone-term-viewbtn ${selecting ? "baud-phone-term-viewbtn-armed" : ""}`}
            aria-pressed={selecting}
            aria-label={selecting ? "stop selecting text" : "select text by dragging"}
            title="select text by dragging - xterm selects locally. While armed the watch takes no pans."
            onClick={() => {
              setSelecting((on) => {
                const next = !on;
                if (!next) {
                  drag.current.dragging = false;
                  termRef.current?.clearSelection();
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
        </div>
      </div>
      {/* Copy and clear, shown only while the sel chip is armed - the only
          time either one means anything. Same row the terminal sheet uses,
          and OUTSIDE the screen div for the same reason it is in the belt
          there: the screen clips its overflow, a control row must not be
          inside the thing it controls. */}
      {selecting ? (
        <div className="baud-phone-term-selrow">
          {copyNote ? <p className="baud-phone-term-selnote">{copyNote}</p> : null}
          <div className="baud-phone-term-selrow-keys">
            <button
              type="button"
              className="baud-phone-term-key"
              disabled={!selText}
              title={selText ? `copy ${selText.length} characters` : "drag across the watch to select first"}
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
                termRef.current?.clearSelection();
                setSelText("");
                setCopyNote(null);
              }}
            >
              clear
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
