import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm, type ILink } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

/**
 * A launch since m6 is an ATTACH: the pty runs a tmux client into the
 * branch's persistent room. Switching cards replaces the client (SIGHUP =
 * detach - the room and whatever runs in it survive), and the staged command
 * is typed only where it can land at a prompt: into a room this spawn just
 * created, or one the fleet scan says has no live claude. `typeIfAttached`
 * carries that second judgment from the card's snapshot.
 */
export interface LaunchSpec {
  /** Branch name - the backend derives the tmux session name from it. */
  room: string;
  /** Branch directory a NEW room starts in (ignored on attach). */
  cwd: string;
  /** The one visible claude command line the click asked for. */
  command: string;
  /** Type the command even when the room already existed (no live claude). */
  typeIfAttached: boolean;
}

export interface TerminalHandle {
  launch(spec: LaunchSpec): void;
  /**
   * Type text into the live pty as if the operator had - because they did:
   * every call traces to a click (camera button) or a drop gesture. The text
   * is inserted WITHOUT a newline; sending stays the operator's keystroke.
   * Returns false when there is no live session to type into.
   */
  typeText(text: string): boolean;
}

interface TerminalProps {
  /**
   * A ctrl+clicked file path in the output, already resolved and fenced by
   * the backend - the reading room takes it from here. `line` carries a
   * `:123` suffix when the mention had one.
   */
  onOpenFile: (path: string, line: number | null) => void;
  /**
   * Branch names whose card shows a live interactive claude - the fleet
   * snapshot's knowledge, handed down so the slash-command chips only
   * render where a chat box actually exists to receive them.
   */
  liveBranches: string[];
}

/**
 * The memory rituals as one-click chips (Patrick idea 2026-08-10): slash
 * commands are invisible culture - a new operator has no way to discover
 * /prep exists, let alone when to use it. The hover text IS the teaching.
 * Sent WITH the newline - one click runs the command, that is the point.
 * /clear stays typed on purpose: deliberate friction on the one that
 * discards a conversation.
 */
const SLASH_COMMANDS: { cmd: string; hint: string }[] = [
  {
    cmd: "/memo",
    hint: "quick memory update - the agent banks what you just discussed and keeps going. Light, casual, use it whenever",
  },
  {
    cmd: "/prep",
    hint: "session wrap-up - memories saved, plans reconciled, loose ends written down. Do this before closing for the day",
  },
  {
    cmd: "/compact",
    hint: "compress the conversation to free context - the agent re-grounds itself and continues. Survivable by design",
  },
];

/**
 * What a file mention looks like in terminal output: a slashed path
 * (absolute or relative) or a bare filename with an extension, optionally
 * carrying a `:123` line suffix. Deliberately loose - every candidate still
 * has to RESOLVE to a real file inside the fence before it becomes a link,
 * so a false match here costs nothing.
 */
const PATH_CANDIDATE = /(?:\/?[\w.+-]+(?:\/[\w.+-]+)+|[\w+-][\w.+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::\d+)?/g;

interface PathMention {
  /** 0-based column of the match in the row's text. */
  index: number;
  /** The exact matched text - the underline covers all of it. */
  raw: string;
  path: string;
  line: number | null;
}

function pathMentions(text: string): PathMention[] {
  const mentions: PathMention[] = [];
  for (const match of text.matchAll(PATH_CANDIDATE)) {
    const raw = match[0];
    const parts = /^(.*?)(?::(\d+))?$/.exec(raw);
    // A sentence ending in a path leaves its full stop on the match.
    const path = (parts?.[1] ?? raw).replace(/\.+$/, "");
    if (!path) continue;
    mentions.push({
      index: match.index ?? 0,
      raw,
      path,
      line: parts?.[2] ? Number(parts[2]) : null,
    });
  }
  return mentions;
}

/** Mirrors `PtyEvent` in src-tauri/src/pty.rs. */
type PtyEvent =
  | { kind: "data"; session: string; base64: string }
  | { kind: "exit"; session: string };

/** Mirrors `SpawnResult` in src-tauri/src/pty.rs. */
interface SpawnResult {
  id: string;
  created: boolean;
}

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
 * AIPass root. Every byte comes from the human: typed keystrokes, or the one
 * visible command line `run()` writes when they click a card's launch button.
 */
const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { onOpenFile, liveBranches },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>("opening");
  const [failure, setFailure] = useState<string | null>(null);

  // Mirrors of the effect's locals, so launch() can reach the live session.
  const sessionRef = useRef<string | null>(null);
  const termRef = useRef<XTerm | null>(null);
  // A launch waiting for the next spawn; consumed exactly once.
  const pendingRef = useRef<LaunchSpec | null>(null);
  // The room the CURRENT pty is a window into - null for the scratch shell.
  const [room, setRoom] = useState<string | null>(null);
  // Where relative paths in the output resolve: the seated room's branch
  // dir, or null (= the AIPass root) for the scratch shell. Best effort -
  // the shell can cd away, but claude cites repo-relative or absolute paths.
  const cwdRef = useRef<string | null>(null);
  // The prop, ref'd so the link provider (created once per pty) never goes
  // stale against a re-rendering parent.
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;

  const restart = useCallback(() => {
    setFailure(null);
    setPhase("opening");
    setGeneration((current) => current + 1);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      launch(spec: LaunchSpec) {
        pendingRef.current = spec;
        // Bumping the generation tears the old pty down. For a room client
        // that SIGHUP is a detach - the previous agent keeps running - and
        // the new spawn attaches to the next room. Also revives a dead
        // terminal for free.
        restart();
      },
      typeText(text: string) {
        const id = sessionRef.current;
        if (!id) return false;
        void invoke("pty_write", { id, data: text }).catch(() => {});
        termRef.current?.focus();
        return true;
      },
    }),
    [restart],
  );

  // Detach (room) / kill (scratch shell): end what is on the pty. A room and
  // everything inside it survives - only the window closes. The exit event
  // then raises the curtain.
  const kill = useCallback(() => {
    const id = sessionRef.current;
    if (!id) return;
    void invoke("pty_kill", { id }).catch(() => {});
  }, []);

  // The one door that actually ENDS a room (Patrick ruling 2026-08-10).
  // tmux kills the session; our client dies with it, which raises the
  // curtain through the normal exit event.
  const endRoom = useCallback(() => {
    if (!room) return;
    void invoke("room_kill", { branchName: room }).catch((err) => {
      setFailure(describe(err));
    });
  }, [room]);

  // A slash-command chip: the command, a beat, then Enter - exactly as if
  // the operator typed it, because they clicked for it. Enter is `\r`
  // (what a keyboard sends), NOT `\n`: claude's raw-mode input treats a
  // linefeed as text, which left the command sitting unsubmitted in the
  // box (Patrick-caught on the first live click, 2026-08-10). The beat
  // lets the slash palette settle on the exact match before the submit.
  const sendCommand = useCallback((cmd: string) => {
    const id = sessionRef.current;
    if (!id) return;
    void invoke("pty_write", { id, data: cmd }).catch(() => {});
    window.setTimeout(() => {
      void invoke("pty_write", { id, data: "\r" }).catch(() => {});
    }, 150);
    termRef.current?.focus();
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
      // Claude wraps its file citations in OSC 8 hyperlinks (file:// URIs).
      // Without a handler xterm silently DROPS non-http links - no hover, no
      // click - and anything that does fire escapes to the OS. This handler
      // claims the layer: file:// goes to the reading room through the same
      // fence as everything else, http(s) to the system browser, both only
      // on the ctrl-chord. Every other scheme is ignored on purpose.
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (event, uri, range) => {
          if (!event.ctrlKey && !event.metaKey) return;
          if (uri.startsWith("file://")) {
            let path: string;
            try {
              path = decodeURIComponent(new URL(uri).pathname);
            } catch {
              return;
            }
            // The URI carries no line number, but the visible citation often
            // does - inside the link text (`foo.py:42`) or right after it.
            const row = term.buffer.active.getLine(range.end.y - 1);
            const rowText = row?.translateToString(true) ?? "";
            const inLink = /:(\d+)$/.exec(rowText.slice(range.start.x - 1, range.end.x));
            const afterLink = /^:(\d+)/.exec(rowText.slice(range.end.x));
            const line = inLink ? Number(inLink[1]) : afterLink ? Number(afterLink[1]) : null;
            void invoke<(string | null)[]>("resolve_paths", {
              base: cwdRef.current,
              candidates: [path],
            })
              .then(([target]) => {
                if (target && !disposed) onOpenFileRef.current(target, line);
              })
              .catch(() => {});
          } else if (/^https?:\/\//.test(uri)) {
            void openUrl(uri).catch((err) => {
              if (!disposed) setFailure(describe(err));
            });
          }
        },
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    // Ctrl+click links, IDE-style. Plain clicks stay tmux's (mouse mode is
    // on in rooms) - only the ctrl-chord activates. URLs go to the system
    // browser through the opener plugin's url-only grant.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!event.ctrlKey && !event.metaKey) return;
        void openUrl(uri).catch((err) => {
          if (!disposed) setFailure(describe(err));
        });
      }),
    );

    // File paths become links only if the backend resolves them to a real
    // file inside the fence - hover asks, per line, and an unresolvable
    // mention simply never underlines. Ctrl+click opens it in the reading
    // room beside the live terminal, at the cited line.
    const fileLinks = term.registerLinkProvider({
      provideLinks(row, callback) {
        const bufferLine = term.buffer.active.getLine(row - 1);
        if (!bufferLine) return callback(undefined);
        const mentions = pathMentions(bufferLine.translateToString(true));
        if (mentions.length === 0) return callback(undefined);

        void invoke<(string | null)[]>("resolve_paths", {
          base: cwdRef.current,
          candidates: mentions.map((mention) => mention.path),
        })
          .then((resolved) => {
            const links = mentions.flatMap((mention, i): ILink[] => {
              const target = resolved[i];
              if (!target) return [];
              return [
                {
                  // 1-based columns, end inclusive - web-links' convention.
                  range: {
                    start: { x: mention.index + 1, y: row },
                    end: { x: mention.index + mention.raw.length, y: row },
                  },
                  text: mention.raw,
                  activate: (event) => {
                    if (event.ctrlKey || event.metaKey) {
                      onOpenFileRef.current(target, mention.line);
                    }
                  },
                },
              ];
            });
            callback(links.length > 0 ? links : undefined);
          })
          .catch(() => callback(undefined));
      },
    });

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

    termRef.current = term;

    const channel = new Channel<PtyEvent>();
    channel.onmessage = (event) => {
      if (disposed) return;
      if (event.kind === "data") {
        term.write(decodeChunk(event.base64));
        return;
      }
      sessionRef.current = null;
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

    // The staged launch, if any, is consumed by THIS spawn: its room shapes
    // the pty_create call, and the created-flag decides whether the command
    // gets typed.
    const spec = pendingRef.current;
    pendingRef.current = null;
    setRoom(spec?.room ?? null);
    cwdRef.current = spec?.cwd ?? null;

    void invoke<SpawnResult>("pty_create", {
      cols: term.cols,
      rows: term.rows,
      room: spec?.room ?? null,
      cwd: spec?.cwd ?? null,
      onData: channel,
    })
      .then(({ id, created }) => {
        if (disposed) {
          // Unmounted mid-flight: kill the client we just asked for.
          void invoke("pty_kill", { id }).catch(() => {});
          return;
        }
        sessionId = id;
        sessionRef.current = id;
        // A shell that dies instantly can report its exit before this resolves,
        // so never promote a session the channel already buried.
        setPhase((current) => (current === "ended" ? current : "live"));
        term.focus();
        pushSize();

        // Type the claude command only where it lands at a prompt: a room
        // this spawn created, or one the card's snapshot said holds no live
        // claude. Typing into an existing claude would fill its input box.
        // The pty's input buffer holds it until the shell reads - no race.
        if (spec && (created || spec.typeIfAttached)) {
          void invoke("pty_write", { id, data: `${spec.command}\n` }).catch((err) => {
            if (!disposed) setFailure(describe(err));
          });
        }
      })
      .catch((err) => {
        if (disposed) return;
        setFailure(describe(err));
        setPhase("ended");
      });

    return () => {
      disposed = true;
      sessionRef.current = null;
      termRef.current = null;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      fileLinks.dispose();
      keystrokes.dispose();
      if (sessionId) void invoke("pty_kill", { id: sessionId }).catch(() => {});
      term.dispose();
    };
  }, [generation]);

  return (
    <section className="baud-terminal" aria-label="operator shell">
      <div className="baud-terminal-host" ref={hostRef} />

      {phase === "live" ? (
        <span className="baud-terminal-actions">
          {room && liveBranches.includes(room)
            ? SLASH_COMMANDS.map(({ cmd, hint }) => (
                <button
                  key={cmd}
                  type="button"
                  className="baud-terminal-kill baud-terminal-cmd"
                  title={hint}
                  onClick={() => sendCommand(cmd)}
                >
                  {cmd}
                </button>
              ))
            : null}
          {room ? (
            <>
              <button
                type="button"
                className="baud-terminal-kill baud-terminal-detach"
                title={`detach - the ${room} room keeps running without a window`}
                onClick={kill}
              >
                ⇠ detach
              </button>
              <button
                type="button"
                className="baud-terminal-kill"
                title={`END the ${room} room - kills its session and everything inside`}
                onClick={endRoom}
              >
                ✕ end room
              </button>
            </>
          ) : (
            <button
              type="button"
              className="baud-terminal-kill"
              title="kill this shell - a running claude stays resumable"
              onClick={kill}
            >
              ✕ kill
            </button>
          )}
        </span>
      ) : null}

      {phase === "ended" ? (
        <button type="button" className="baud-terminal-curtain" onClick={restart}>
          <span className="baud-terminal-curtain-line">
            {failure ? "terminal unavailable" : room ? "window closed" : "session ended"}
          </span>
          <span className="baud-terminal-curtain-hint">
            {failure ?? "click to open a scratch shell - or pick a card"}
          </span>
        </button>
      ) : null}
    </section>
  );
});

export default Terminal;
