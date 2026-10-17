/**
 * The phone's watch: a read-only monitor pane in the stage. Reference: docs/phone/monitor.md
 * No stdin twice over: `disableStdin` here, and @api's read-only session refuses writes.
 */

import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { openRoomSocket } from "../host";
import { HostError } from "../host/transport.http";
import type { BranchStatus } from "../types";
import {
  HANDSHAKE_POLL_MS,
  LINES_PER_NOTCH,
  MAX_FONT,
  MIN_FONT,
  PAN_ACCELERATION,
  RECONNECT_MS,
  RECONNECT_TRIES,
} from "./TerminalSheet";
import { type CloseKind, closeIsFinal, closeKind, deadFace, errorAfterClose, watchLabel } from "./lib/socketClose";

/** A monitor is read at a glance, so it opens at the legible 10, not the terminal's 7. */
const FONT_SIZE = 10;

/** 1008 is the caller's, 1011 the host's; 4000 (the watched process ended) is the overlay's to say. */
function closeSentence(event: CloseEvent): string | null {
  if (event.code === 1008) return event.reason || "the watch refused this request";
  if (event.code === 1011) return event.reason || "the host could not open the watch";
  return null;
}

interface MonitorSheetProps {
  branch: BranchStatus;
}

export default function MonitorSheet({ branch }: MonitorSheetProps) {
  /** Frozen at mount: a watch re-spawned per poll would be the per-poll leak the room lane killed. */
  const watching = useRef(branch).current;
  const host = useRef<HTMLDivElement | null>(null);
  /** xterm's own mount, kept free of React children so React and xterm never manage one parent. */
  const mount = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // `closed` stays null until a socket has closed, so the overlay never shows while
  // still connecting; "ended" and "refused" are final, with no ladder.
  const [opened, setOpened] = useState(false);
  const [closed, setClosed] = useState<CloseKind | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  /** Consecutive tries with no frame. A ref: reading it must not re-run the socket effect. */
  const retries = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const rewatchNow = () => {
    retries.current = 0;
    setAttempt((n) => n + 1);
  };
  /** View controls only: no chip that writes a byte comes over to a watch. */
  const [full, setFull] = useState(false);
  const [font, setFont] = useState(FONT_SIZE);
  const [selecting, setSelecting] = useState(false);
  /** The armed flag for touch listeners bound once per watch. */
  const selectingRef = useRef(false);
  selectingRef.current = selecting;
  const [selText, setSelText] = useState("");
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /** `dragging` holds the ResizeObserver's fit (a fit mid-drag drops the selection); `heldFit` owes one on lift. */
  const drag = useRef({ dragging: false, heldFit: false });
  /** A ref, not state: a font in the effect's deps would tear down the socket per press. */
  const fontNow = useRef(FONT_SIZE);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);

  /** Set the size, re-measure, then tell the watch - or the client renders a geometry it never declared. */
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
      return;
    }
    resizeRef.current?.();
  }

  /**
   * Every step runs synchronously inside the tap: plain http is not a secure context, so
   * the lane is `execCommand`. The scratch field is readOnly with inputMode none: no keyboard.
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
    // Off-screen, NOT hidden: display:none makes the field unselectable and copies nothing.
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
    // Gestures bind to the xterm-only mount, not the screen: an armed selection
    // preventDefaults every touch, and the corner buttons are the mount's siblings.
    const surface = mount.current;
    setError(null);

    const xterm = new XTerm({
      convertEol: false,
      fontSize: fontNow.current,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace',
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

    // A finger pan scrolls xterm's own scrollback; there is no room to forward a wheel to.
    let panFrom: number | null = null;
    let panRest = 0;
    const cellHeight = () => {
      const rows = screen.querySelector(".xterm-rows") as HTMLElement | null;
      const measured = rows && xterm.rows ? rows.clientHeight / xterm.rows : 0;
      return measured > 0 ? measured : 14;
    };
    // Forged drag, TerminalSheet's rules, with one fork: shift ONLY when an application
    // owns the mouse. With tracking off, shift+mousedown extends a selection that does not exist.
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
        // A second mousedown would clear the selection, so a stray second finger is swallowed.
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
      xterm.scrollLines((notches > 0 ? -Math.abs(notches) : Math.abs(notches)) * LINES_PER_NOTCH);
      event.preventDefault();
    };
    const endGesture = (event: TouchEvent) => {
      if (selectingRef.current) {
        const p = drag.current;
        if (!p.dragging) return;
        // changedTouches: the lifted finger is gone from `touches`, and a mouseup at 0,0 collapses the range.
        const touch = event.changedTouches[0];
        if (touch) {
          event.preventDefault();
          forge(document, "mouseup", touch);
        }
        p.dragging = false;
        readSelection();
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
    // Firefox Android fires the synthetic click despite the preventDefault (Bugzilla 1016480),
    // and a slow drag is a long press to it (Bugzilla 1481923).
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
    socketRef.current = socket;
    /** Per socket: did it reach open, and has it carried a frame (which resets the rung). */
    let reachedOpen = false;
    let heard = false;

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const { cols, rows } = xterm;
      if (cols > 0 && rows > 0) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };
    resizeRef.current = sendResize;

    socket.onopen = () => {
      reachedOpen = true;
      setLive(true);
      setOpened(true);
      setClosed(null);
      setError(null);
      // The monitor draws at 80x24 until told its size.
      sendResize();
    };
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      xterm.write(new Uint8Array(event.data));
      if (!heard) {
        heard = true;
        retries.current = 0;
      }
    };
    socket.onerror = () => {
      setError("the watch refused this connection - the token was rejected, or the host is unreachable");
    };
    socket.onclose = (event) => {
      socketRef.current = null;
      setLive(false);
      setClosed(closeKind(event.code));
      const said = closeSentence(event);
      setError((previous) => errorAfterClose(previous, said, reachedOpen));
    };

    const observer = new ResizeObserver(() => {
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
      socketRef.current = null;
      // Close FIRST, then dispose: the close is what ends the observer process on the host.
      socket.onclose = null;
      socket.close();
      xterm.dispose();
    };
  }, [watching, attempt]);

  /** The room's reconnect ladder, armed only after a non-final close. */
  useEffect(() => {
    if (live || closed === null || closeIsFinal(closed)) {
      setReconnecting(false);
      return;
    }
    let timer = 0;
    const armIn = (wait: number) => {
      window.clearTimeout(timer);
      setReconnecting(true);
      timer = window.setTimeout(() => {
        const open = socketRef.current;
        if (open && open.readyState === WebSocket.CONNECTING) {
          armIn(HANDSHAKE_POLL_MS);
          return;
        }
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
  }, [live, closed, attempt]);

  const dead = live ? null : deadFace({ lane: "watch", label: watchLabel(watching.name), closed, opened, reconnecting });

  return (
    <section className={`baud-phone-term ${full ? "baud-phone-term-full" : ""}`}>
      {error ? <p className="baud-phone-error">{error}</p> : null}
      <div ref={host} className="baud-phone-term-screen">
        <div ref={mount} className="baud-phone-term-host" />
        {dead ? (
          <div className="baud-phone-term-dead">
            <p className="baud-phone-term-dead-word">{dead.word}</p>
            <p className="baud-phone-term-dead-why">{dead.why}</p>
            {dead.retry ? (
              <button type="button" className="baud-phone-term-reattach" onClick={rewatchNow}>
                {dead.retry}
              </button>
            ) : null}
            {dead.ladder ? <p className="baud-phone-term-dead-why">{dead.ladder}</p> : null}
          </div>
        ) : null}
        {/* Fullscreen is only a class: the xterm and its socket must be the same objects after. */}
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
      {/* Outside the screen div: the screen clips its overflow. */}
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
