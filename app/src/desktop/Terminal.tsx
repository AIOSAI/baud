import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  HostChannel,
  openExternal,
  ptyCreate,
  ptyKill,
  ptyResize,
  ptyWrite,
  resolvePaths,
  roomKill,
} from "../host";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm, type ILink } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

import { slashCommand } from "../phone/lib/rooms";

/** A launch attaches a tmux client to the branch's room; the command is typed only where it lands at a prompt. */
export interface LaunchSpec {
  /** Branch name - the backend derives the tmux session name from it. */
  room: string;
  /** Branch directory a NEW room starts in (ignored on attach). */
  cwd: string;
  /** The branch's project; a room name carries it, so a roster card names its own. null means the seat's. */
  project: string | null;
  /** The one visible claude command line the click asked for. */
  command: string;
  /** Type the command even when the room already existed (no live claude). */
  typeIfAttached: boolean;
}

export interface TerminalHandle {
  launch(spec: LaunchSpec): void;
  /** Type text into the live pty WITHOUT a newline (sending stays the operator's keystroke); false when no session. */
  typeText(text: string): boolean;
}

interface TerminalProps {
  /** A ctrl+clicked file path from the output, already resolved and fenced by the backend. */
  onOpenFile: (path: string, line: number | null) => void;
  /** The operator ended this branch's room and tmux confirmed it; App keeps it dead until the card reopens. */
  onRoomEnded: (branch: string) => void;
  /** Every tmux session holding a live claude, machine-wide: sessions, not seat branches, so a room in
   *  another project still gets its slash-command chips. */
  liveSessions: string[];
  /** The live sessions whose card runs Codex, where the ritual chips type `$memo` and `$prep`. */
  codexSessions: string[];
}

/** The memory rituals as one-click chips. /clear is left out on purpose: it discards a conversation. */
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

/** A file mention, with an optional `:123`. Deliberately loose: every candidate must still resolve inside the fence. */
const PATH_CANDIDATE = /(?:\/?[\w.+-]+(?:\/[\w.+-]+)+|[\w+-][\w.+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::\d+)?/g;

interface PathMention {
  index: number;
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

type Phase = "opening" | "live" | "ended";

const FONT_SIZE = 13;
const SCROLLBACK_LINES = 5000;

/** Read from the stylesheet, so theme.css stays the one palette. */
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

/** Raw bytes, not a string: a chunk can split a UTF-8 character and only xterm's stateful decoder rejoins it. */
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
 * The operator's shell: one PTY with the user's privileges; every byte comes from a keystroke or a click.
 * Reference: docs/desktop/rooms.md
 */
const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { onOpenFile, onRoomEnded, liveSessions, codexSessions },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>("opening");
  const [failure, setFailure] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const pendingRef = useRef<LaunchSpec | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  // End-room must ask in the project the attach used: the seat may have moved on since.
  const roomProjectRef = useRef<string | null>(null);
  // The tmux session the room resolved to (BAUD's or an outside one), named on the end-room button.
  const [session, setSession] = useState<string | null>(null);
  // Best effort: the shell can cd away, but claude cites repo-relative or absolute paths.
  const cwdRef = useRef<string | null>(null);
  // Ref'd because the link provider is created once per pty.
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
        // The old room client's SIGHUP is a detach: the previous agent keeps running.
        restart();
      },
      typeText(text: string) {
        const id = sessionRef.current;
        if (!id) return false;
        void ptyWrite(id, text).catch(() => {});
        termRef.current?.focus();
        return true;
      },
    }),
    [restart],
  );

  const kill = useCallback(() => {
    const id = sessionRef.current;
    if (!id) return;
    void ptyKill(id).catch(() => {});
  }, []);

  // Only a CONFIRMED kill records "stays dead": a room that refused to die is still alive.
  const endRoom = useCallback(() => {
    if (!room) return;
    void roomKill(room, roomProjectRef.current)
      .then(() => onRoomEnded(room))
      .catch((err) => {
        setFailure(describe(err));
      });
  }, [room, onRoomEnded]);

  // Enter is `\r`, NOT `\n`: claude's raw-mode input takes a linefeed as text. The beat lets the slash palette settle.
  const sendCommand = useCallback((cmd: string) => {
    const id = sessionRef.current;
    if (!id) return;
    void ptyWrite(id, cmd).catch(() => {});
    window.setTimeout(() => {
      void ptyWrite(id, "\r").catch(() => {});
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
      // Claude's OSC 8 file:// links: without this handler xterm drops non-http links. Other schemes are ignored on purpose.
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
            // The URI has no line number; the visible citation often does.
            const row = term.buffer.active.getLine(range.end.y - 1);
            const rowText = row?.translateToString(true) ?? "";
            const inLink = /:(\d+)$/.exec(rowText.slice(range.start.x - 1, range.end.x));
            const afterLink = /^:(\d+)/.exec(rowText.slice(range.end.x));
            const line = inLink ? Number(inLink[1]) : afterLink ? Number(afterLink[1]) : null;
            void resolvePaths(cwdRef.current, [path])
              .then(([target]) => {
                if (target && !disposed) onOpenFileRef.current(target, line);
              })
              .catch(() => {});
          } else if (/^https?:\/\//.test(uri)) {
            void openExternal(uri).catch((err) => {
              if (!disposed) setFailure(describe(err));
            });
          }
        },
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    // Ctrl-chord only: plain clicks belong to tmux's mouse mode.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!event.ctrlKey && !event.metaKey) return;
        void openExternal(uri).catch((err) => {
          if (!disposed) setFailure(describe(err));
        });
      }),
    );

    const fileLinks = term.registerLinkProvider({
      provideLinks(row, callback) {
        const bufferLine = term.buffer.active.getLine(row - 1);
        if (!bufferLine) return callback(undefined);
        const mentions = pathMentions(bufferLine.translateToString(true));
        if (mentions.length === 0) return callback(undefined);

        void resolvePaths(
          cwdRef.current,
          mentions.map((mention) => mention.path),
        )
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

    const channel = new HostChannel<PtyEvent>();
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
      void ptyWrite(sessionId, data).catch((err) => {
        if (!disposed) setFailure(describe(err));
      });
    });

    // Fit the view AND tell the shell, or they disagree on columns and long lines wrap wrong.
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

    const spec = pendingRef.current;
    pendingRef.current = null;
    setRoom(spec?.room ?? null);
    setSession(null);
    cwdRef.current = spec?.cwd ?? null;
    roomProjectRef.current = spec?.project ?? null;

    void ptyCreate({
      cols: term.cols,
      rows: term.rows,
      room: spec?.room ?? null,
      cwd: spec?.cwd ?? null,
      project: spec?.project ?? null,
      onData: channel,
    })
      .then(({ id, created, room: attached }) => {
        if (disposed) {
          void ptyKill(id).catch(() => {});
          return;
        }
        sessionId = id;
        sessionRef.current = id;
        setSession(attached);
        // A shell that dies instantly can report its exit before this resolves,
        // so never promote a session the channel already buried.
        setPhase((current) => (current === "ended" ? current : "live"));
        term.focus();
        pushSize();

        // Typing into a live claude would fill its input box. The pty buffers it until the shell reads.
        if (spec && (created || spec.typeIfAttached)) {
          void ptyWrite(id, `${spec.command}\n`).catch((err) => {
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
      if (sessionId) void ptyKill(sessionId).catch(() => {});
      term.dispose();
    };
  }, [generation]);

  return (
    <section className="baud-terminal" aria-label="operator shell">
      <div className="baud-terminal-host" ref={hostRef} />

      {phase === "live" ? (
        <span className="baud-terminal-actions">
          {session && liveSessions.includes(session)
            ? SLASH_COMMANDS.map(({ cmd, hint }) => {
                const spelled = slashCommand(cmd, codexSessions.includes(session) ? "codex" : "claude");
                return (
                  <button
                    key={cmd}
                    type="button"
                    className="baud-terminal-kill baud-terminal-cmd"
                    title={hint}
                    onClick={() => sendCommand(spelled)}
                  >
                    {spelled}
                  </button>
                );
              })
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
                title={
                  session
                    ? `END the ${room} room - kills tmux session '${session}' and everything inside`
                    : `END the ${room} room - kills its session and everything inside`
                }
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
