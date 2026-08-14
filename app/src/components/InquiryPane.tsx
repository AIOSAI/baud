import { useEffect, useRef, useState } from "react";
import { HostChannel, ptyCreate, ptyKill, ptyResize, ptyWrite } from "../host";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

/**
 * A tier-1 inquiry terminal (m9 phase 4): the card's help button pops a
 * REAL shell seated in that branch with the agent's help already run.
 *
 * Deliberately NOT keyboard-blocked (Patrick ruling 2026-08-11): the whole
 * point is continuing the investigation - follow-up commands, `drone
 * @agent <cmd> --help`, a peek at a README. There is no technical fence on
 * what can be typed, because a typed-input filter would be theater
 * (enforcement-honesty doctrine, DPLAN-0284) - the framing and the name do
 * the work, exactly like the scratch shell. A hard fence, if ever wanted,
 * is tier 2's Docker isolation, not a keyword list.
 *
 * One per branch, closable only by its tab's ✕ or the corner kill - when
 * the shell exits (operator types `exit`, or the kill button fires) the
 * pane reports up and the tab closes.
 */

/** Mirrors `PtyEvent` in src-tauri/src/pty.rs. */
type PtyEvent =
  | { kind: "data"; session: string; base64: string }
  | { kind: "exit"; session: string };

interface InquiryPaneProps {
  /** Branch (or project) name - names the pane and its kill button. */
  branch: string;
  /** Directory the shell opens in. */
  cwd: string;
  /**
   * One command line typed into the fresh shell, or null for a bare prompt.
   * The caller decides: the card's `?` sends the branch's help command, the
   * terminal buttons send nothing and hand over an empty shell.
   */
  command?: string | null;
  /** The shell ended - operator exit, or the corner kill. */
  onExited: () => void;
}

/**
 * The help command a branch answers to. `aipass` is the ecosystem's one
 * exception (Patrick-caught 2026-08-11): the user's front-door CLI with its
 * own binary - drone cannot resolve @aipass, so its card asks the binary
 * itself. Everyone else speaks through drone.
 */
export function helpCommand(branch: string): string {
  return branch === "aipass" ? "aipass --help" : `drone @${branch} --help`;
}

const FONT_SIZE = 13;
const SCROLLBACK_LINES = 5000;

/** Same stylesheet-read theme as the operator terminal - one palette. */
function inquiryTheme(host: HTMLElement) {
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

function decodeChunk(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export default function InquiryPane({
  branch,
  cwd,
  command = null,
  onExited,
}: InquiryPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let sessionId: string | null = null;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: getComputedStyle(host).getPropertyValue("--baud-mono").trim() || "monospace",
      fontSize: FONT_SIZE,
      scrollback: SCROLLBACK_LINES,
      theme: inquiryTheme(host),
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

    // Real stdin - the tier-1 line. Every byte here is the operator's.
    const keystrokes = term.onData((data) => {
      if (!sessionId || disposed) return;
      void ptyWrite(sessionId, data).catch((err) => {
        if (!disposed) setFailure(err instanceof Error ? err.message : String(err));
      });
    });

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

    void ptyCreate({
      cols: term.cols,
      rows: term.rows,
      room: null,
      cwd,
      onData: channel,
    })
      .then(({ id }) => {
        if (disposed) {
          void ptyKill(id).catch(() => {});
          return;
        }
        sessionId = id;
        sessionRef.current = id;
        term.focus();
        pushSize();
        // The one visible command line the click asked for - typed into the
        // fresh shell's input buffer, exactly what the operator would have
        // typed by hand. A terminal button asks for none, and gets a prompt
        // and nothing else.
        if (command) {
          void ptyWrite(id, `${command}\n`).catch((err) => {
            if (!disposed) setFailure(err instanceof Error ? err.message : String(err));
          });
        }
      })
      .catch((err) => {
        if (disposed) return;
        setFailure(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      sessionRef.current = null;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      keystrokes.dispose();
      if (sessionId) void ptyKill(sessionId).catch(() => {});
      term.dispose();
    };
  }, [branch, cwd, command]);

  const kill = () => {
    const id = sessionRef.current;
    if (!id) {
      onExitedRef.current();
      return;
    }
    void ptyKill(id).catch(() => {});
  };

  return (
    <section
      className="baud-terminal baud-inquiry"
      aria-label={command ? `${branch} help terminal` : `${branch} shell`}
    >
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
          title={`kill this shell - ${branch} is untouched`}
          onClick={kill}
        >
          ✕ kill
        </button>
      </span>
    </section>
  );
}
