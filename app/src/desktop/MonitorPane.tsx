import { useEffect, useRef, useState } from "react";
import { HostChannel, monitorCreate, ptyKill, ptyResize } from "../host";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

/** A read-only monitor pane; its existence is the header toggle's state. Reference: docs/desktop/rooms.md */

/** Mirrors `PtyEvent` in src-tauri/src/pty.rs. */
type PtyEvent =
  | { kind: "data"; session: string; base64: string }
  | { kind: "exit"; session: string };

interface MonitorPaneProps {
  /** What to watch: null = mission control, "commons", or a branch list; sent as a token, never a command line. */
  target: string | null;
  /** A human word for the corner button's title. */
  label: string;
  /** The session ended - by the corner button, or by dying on its own. */
  onExited: () => void;
}

const FONT_SIZE = 13;
const SCROLLBACK_LINES = 5000;

/** Same stylesheet-read theme as the operator terminal - one palette. */
function monitorTheme(host: HTMLElement) {
  const style = getComputedStyle(host);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    background: token("--baud-bg-panel", "#0d1211"),
    foreground: token("--baud-ink", "#d6e2dc"),
    cursor: token("--baud-bg-panel", "#0d1211"),
    cursorAccent: token("--baud-bg-panel", "#0d1211"),
    selectionBackground: token("--baud-line-strong", "#2b3a35"),
  };
}

function decodeChunk(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export default function MonitorPane({ target, label, onExited }: MonitorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The prop, ref'd so the channel handler (created once) never goes stale.
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let sessionId: string | null = null;

    const term = new XTerm({
      // No cursor, no input: this is a pane of glass, not a seat.
      disableStdin: true,
      cursorBlink: false,
      fontFamily: getComputedStyle(host).getPropertyValue("--baud-mono").trim() || "monospace",
      fontSize: FONT_SIZE,
      scrollback: SCROLLBACK_LINES,
      theme: monitorTheme(host),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const measure = () => {
      if (host.offsetWidth === 0 || host.offsetHeight === 0) return false;
      try {
        fit.fit();
        return true;
      } catch {
        return false;
      }
    };

    measure();

    const channel = new HostChannel<PtyEvent>();
    channel.onmessage = (event) => {
      if (disposed) return;
      if (event.kind === "data") {
        term.write(decodeChunk(event.base64));
        return;
      }
      sessionRef.current = null;
      onExitedRef.current();
    };

    const pushSize = () => {
      if (!measure() || !sessionId || disposed) return;
      void ptyResize(sessionId, term.cols, term.rows).catch(
        () => {},
      );
    };

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(pushSize);
    });
    observer.observe(host);

    void monitorCreate({
      cols: term.cols,
      rows: term.rows,
      target,
      onData: channel,
    })
      .then((id) => {
        if (disposed) {
          // Unmounted mid-flight: kill the monitor we just asked for.
          void ptyKill(id).catch(() => {});
          return;
        }
        sessionId = id;
        sessionRef.current = id;
        pushSize();
      })
      .catch((err) => {
        if (disposed) return;
        // Shown in place rather than reported up: the operator sees WHY the
        // pane is empty, and closes it with the same corner button.
        setFailure(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      sessionRef.current = null;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      if (sessionId) void ptyKill(sessionId).catch(() => {});
      term.dispose();
    };
    // A monitor never re-targets in place - the toggle unmounts and remounts.
  }, [target]);

  // The pane's own death door: kill the pty; the exit event does the rest.
  const kill = () => {
    const id = sessionRef.current;
    if (!id) {
      // Nothing spawned (or it already died) - report up directly.
      onExitedRef.current();
      return;
    }
    void ptyKill(id).catch(() => {});
  };

  return (
    <section className="baud-terminal baud-monitor" aria-label={`${label} monitor`}>
      <div className="baud-terminal-host" ref={hostRef} />

      {failure ? (
        <div className="baud-monitor-failure" role="alert">
          <span className="baud-failure-tag">FAULT</span>
          <span className="baud-failure-text">{failure}</span>
        </div>
      ) : null}

      <span className="baud-terminal-actions">
        <button
          type="button"
          className="baud-terminal-kill"
          title={`close the ${label} monitor - watching stops, nothing else is touched`}
          onClick={kill}
        >
          ✕ close
        </button>
      </span>
    </section>
  );
}
