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

/** Same reading size as the terminal sheet's default - one face, one scale. */
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
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  /** Bumped by the rewatch button - the effect's re-run door. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const screen = host.current;
    if (!screen) return;
    setError(null);

    const xterm = new XTerm({
      convertEol: false,
      fontSize: FONT_SIZE,
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
    xterm.open(screen);
    fit.fit();

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
      fit.fit();
      sendResize();
    });
    observer.observe(screen);

    return () => {
      observer.disconnect();
      // Close FIRST, then dispose - the close is what ends the observer
      // process on the host, and it must go out while the socket exists.
      socket.onclose = null;
      socket.close();
      xterm.dispose();
    };
  }, [watching, attempt]);

  return (
    <section className="baud-phone-term">
      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!live ? (
        <button type="button" className="baud-phone-term-reattach" onClick={() => setAttempt((n) => n + 1)}>
          watch {watching.name}
        </button>
      ) : null}
      <div ref={host} className="baud-phone-term-screen" />
    </section>
  );
}
