import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

/** Mirrors `PtyEvent` in src-tauri/src/pty.rs. */
type PtyEvent =
  | { kind: "data"; session: string; base64: string }
  | { kind: "exit"; session: string };

type Phase = "opening" | "live" | "ended";

const FONT_SIZE = 13;
const SCROLLBACK_LINES = 5000;

/**
 * The xterm theme is read out of the stylesheet, so theme.css stays the single
 * source of truth for BAUD's colours - there is no second palette to drift.
 */
function terminalTheme(host: HTMLElement) {
  const style = getComputedStyle(host);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    background: token("--baud-bg-panel", "#0d1211"),
    foreground: token("--baud-ink", "#d6e2dc"),
    cursor: token("--baud-green", "#4ade80"),
    cursorAccent: token("--baud-bg-panel", "#0d1211"),
    selectionBackground: token("--baud-line-strong", "#2b3a35"),
  };
}

/**
 * Shell output arrives base64-encoded: a 4KB read can split a multi-byte UTF-8
 * character, and only raw bytes let xterm's stateful decoder stitch it back
 * together across chunks.
 */
function decodeChunk(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * The operator's shell. One PTY, the user's own privileges, opened in the
 * AIPass root. BAUD types nothing into it - a human does.
 */
export default function Terminal() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>("opening");
  const [failure, setFailure] = useState<string | null>(null);

  const restart = useCallback(() => {
    setFailure(null);
    setPhase("opening");
    setGeneration((current) => current + 1);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // `disposed` guards the async gap: React can unmount (and StrictMode does,
    // immediately) before pty_create resolves, and that session must still die.
    let disposed = false;
    let sessionId: string | null = null;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: getComputedStyle(host).getPropertyValue("--baud-mono").trim() || "monospace",
      fontSize: FONT_SIZE,
      scrollback: SCROLLBACK_LINES,
      theme: terminalTheme(host),
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

    const channel = new Channel<PtyEvent>();
    channel.onmessage = (event) => {
      if (disposed) return;
      if (event.kind === "data") {
        term.write(decodeChunk(event.base64));
        return;
      }
      setPhase("ended");
    };

    const keystrokes = term.onData((data) => {
      if (!sessionId || disposed) return;
      void invoke("pty_write", { id: sessionId, data }).catch((err) => {
        if (!disposed) setFailure(describe(err));
      });
    });

    // One path for sizing: fit the view *and* tell the shell, or the two
    // disagree about the column count and every long line wraps wrong.
    const pushSize = () => {
      if (!measure() || !sessionId || disposed) return;
      void invoke("pty_resize", { id: sessionId, cols: term.cols, rows: term.rows }).catch(
        () => {},
      );
    };

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(pushSize);
    });
    observer.observe(host);

    void invoke<string>("pty_create", {
      cols: term.cols,
      rows: term.rows,
      onData: channel,
    })
      .then((id) => {
        if (disposed) {
          // Unmounted mid-flight: kill the shell we just asked for.
          void invoke("pty_kill", { id }).catch(() => {});
          return;
        }
        sessionId = id;
        // A shell that dies instantly can report its exit before this resolves,
        // so never promote a session the channel already buried.
        setPhase((current) => (current === "ended" ? current : "live"));
        term.focus();
        pushSize();
      })
      .catch((err) => {
        if (disposed) return;
        setFailure(describe(err));
        setPhase("ended");
      });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      keystrokes.dispose();
      if (sessionId) void invoke("pty_kill", { id: sessionId }).catch(() => {});
      term.dispose();
    };
  }, [generation]);

  return (
    <section className="baud-terminal" aria-label="operator shell">
      <div className="baud-terminal-host" ref={hostRef} />

      {phase === "ended" ? (
        <button type="button" className="baud-terminal-curtain" onClick={restart}>
          <span className="baud-terminal-curtain-line">
            {failure ? "terminal unavailable" : "session ended"}
          </span>
          <span className="baud-terminal-curtain-hint">
            {failure ?? "click to start a new shell"}
          </span>
        </button>
      ) : null}
    </section>
  );
}
