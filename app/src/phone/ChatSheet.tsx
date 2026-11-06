/** One agent's chat on the phone: the extension side panel's feed, send, pending, allow/deny and stop, full height. Reference: docs/phone/chat.md */

import DOMPurify from "dompurify";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { agentAllow, agentDeny, agentFeed, agentInterrupt, agentSend, agentUsage } from "../host";
import type { AgentLine } from "../types";
import { busyView, errText, lastN, linkParts, mergeLines, runLabel, runsOf, sessionChanged, type Answered } from "../extension/lib/chat";
import * as P from "../extension/lib/pending";
import { copyText } from "./lib/copyPath";
import { markdownHtml } from "./lib/markdown";
import { whileVisible } from "./lib/whileVisible";

const FEED_MS = 2000;

interface ChatSheetProps {
  /** `<project>/<name>`, as the host's agent routes name it. */
  agent: string;
  backLabel?: string;
  onClose: () => void;
}

const linked = (text: string): ReactNode[] =>
  linkParts(text).map((p, i) =>
    p.link ? (
      <a key={i} href={p.text} target="_blank" rel="noopener noreferrer">
        {p.text}
      </a>
    ) : (
      p.text
    ),
  );

/** A tap on a code box copies it; the box says "copied" for a moment. */
function copyBlock(e: MouseEvent<HTMLDivElement>) {
  const pre = (e.target as Element).closest("pre");
  if (!pre || !e.currentTarget.contains(pre)) return;
  void copyText(pre.textContent ?? "").then((ok) => {
    if (!ok) return;
    pre.dataset.copied = "";
    setTimeout(() => delete pre.dataset.copied, 1200);
  });
}

export default function ChatSheet({ agent, backLabel = "back", onClose }: ChatSheetProps) {
  const name = agent.split("/")[1] ?? agent;
  const [lines, setLines] = useState<AgentLine[]>([]);
  const [feed, setFeed] = useState<{ busy: boolean; waiting: { tool: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<P.Pending[]>([]);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState("");
  const sheet = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const poke = useRef<() => void>(() => undefined);
  const nextId = useRef(1);

  useEffect(() => {
    let alive = true;
    let held: AgentLine[] = [];
    let session: string | null = null;
    const tick = async (): Promise<void> => {
      try {
        const f = await agentFeed(agent, lastN(held));
        if (!alive) return;
        if (sessionChanged(session, f?.session)) {
          session = f.session ?? null;
          held = [];
          return tick();
        }
        session = f?.session ?? session;
        held = mergeLines(held, Array.isArray(f?.lines) ? f.lines : []);
        setLines(held);
        setFeed({ busy: !!f.busy, waiting: f.waiting ?? null });
        setError(null);
        if (!f.waiting) setAnswered(null);
        setPending((p) => P.settle(p, held));
      } catch (err) {
        if (alive) setError(errText(err));
      }
    };
    poke.current = () => setTimeout(() => void tick(), 600);
    const stop = whileVisible(() => void tick(), FEED_MS);
    agentUsage(agent).then(
      (u) => alive && setProvider(u?.provider ?? null),
      () => undefined,
    );
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      stop();
      clearInterval(clock);
    };
  }, [agent]);

  // The page does not resize under the soft keyboard (phone.html), so the sheet's bottom rises by what it hides.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (sheet.current) sheet.current.style.bottom = hidden > 0 ? `${hidden}px` : "";
      if (atEnd.current && list.current) list.current.scrollTop = list.current.scrollHeight;
    };
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    place();
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, []);

  useLayoutEffect(() => {
    if (atEnd.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [lines, pending, error]);

  const deliver = (id: number, sent: string) =>
    agentSend(agent, sent).then(
      () => poke.current(),
      (err: unknown) => setPending((p) => P.failed(p, id, errText(err))),
    );

  const submit = () => {
    const sent = text.trim();
    if (!sent) return;
    const id = nextId.current++;
    setPending((p) => P.add(p, { id, sent, shown: sent, at: Date.now(), failed: null }));
    setText("");
    atEnd.current = true;
    void deliver(id, sent);
  };

  const resend = (p: P.Pending) => {
    setPending((all) => P.resent(all, p.id, Date.now()));
    void deliver(p.id, p.sent);
  };

  const answer = (allow: boolean) => {
    setAnswered({ at: Date.now(), word: allow ? "allowed" : "denied, and the turn stopped" });
    (allow ? agentAllow : agentDeny)(agent).then(() => poke.current(), (err: unknown) => setFlash(errText(err)));
  };

  const stopAgent = () => agentInterrupt(agent).then(() => poke.current(), (err: unknown) => setFlash(`stop: ${errText(err)}`));

  const toggle = (n: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  const model = [...lines].reverse().find((l) => l.role === "agent" && l.model)?.model ?? provider;
  const busy = busyView(feed, answered, now);

  return (
    <section ref={sheet} className="baud-phone-reader baud-chat">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ {backLabel}
        </button>
        <span className="baud-phone-reader-title">{name} · chat</span>
        {model ? <span className="baud-chat-model">{model}</span> : null}
      </header>

      <div
        ref={list}
        className="baud-chat-feed"
        onScroll={(e) => {
          const b = e.currentTarget;
          atEnd.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
        }}
      >
        {runsOf(lines).map((run) => {
          const l = run[run.length - 1];
          const first = run[0].n;
          const stack = run.length > 1;
          return (
            <div
              key={first}
              className={`baud-chat-line baud-chat-${l.role}${stack ? " baud-chat-stack" : ""}`}
              onClick={stack ? (e) => !(e.target as Element).closest("a, button") && toggle(first) : undefined}
            >
              <small>
                {runLabel(run, name)}
                {stack && (open.has(first) ? " ▴" : " ▾")}
              </small>
              {l.role === "agent" && !stack ? (
                <div className="baud-phone-md baud-chat-md" onClick={copyBlock} dangerouslySetInnerHTML={{ __html: markdownHtml(l.text, DOMPurify) }} />
              ) : (
                <div className="baud-chat-text">
                  {stack && open.has(first) ? run.map((t) => <div key={t.n}>{linked(t.text)}</div>) : linked(l.text)}
                </div>
              )}
            </div>
          );
        })}
        {!lines.length && !error ? <p className="baud-phone-empty">{feed ? "nothing said yet" : "reading…"}</p> : null}
        {pending.map((p) => {
          const look = P.lookOf(p, now);
          return (
            <div key={p.id} className={`baud-chat-line baud-chat-pend baud-chat-pend-${look}`}>
              <small>
                {look === "waiting" ? `sent · waiting for ${name}` : look === "stale" ? `not delivered to ${name} · ` : `not sent: ${p.failed} · `}
                {look !== "waiting" && (
                  <>
                    <button type="button" className="baud-chat-link" onClick={() => resend(p)}>
                      resend
                    </button>
                    {" · "}
                    <button type="button" className="baud-chat-link" onClick={() => setPending((all) => P.discard(all, p.id))}>
                      discard
                    </button>
                  </>
                )}
              </small>
              <div className="baud-chat-text">{p.shown}</div>
            </div>
          );
        })}
        {error ? (
          <p className="baud-phone-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {busy.kind !== "none" && (
        <div className="baud-chat-busy">
          {busy.kind === "busy" && <span>{name} is working…</span>}
          {busy.kind === "answered" && <span>✓ {busy.word}</span>}
          {busy.kind === "waiting" && (
            <>
              <span>waiting for your permission{busy.tool ? `: ${busy.tool}` : ""}</span>
              <button type="button" onClick={() => answer(true)}>
                allow
              </button>
              <button type="button" onClick={() => answer(false)}>
                deny
              </button>
            </>
          )}
        </div>
      )}
      {flash ? (
        <p className="baud-phone-error" role="alert">
          {flash}
        </p>
      ) : null}

      <form
        className="baud-chat-ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea value={text} maxLength={20000} placeholder={`Message ${name}`} onChange={(e) => setText(e.target.value)} />
        <button type="submit" title={`send to ${name}`} aria-label="send">
          ➤
        </button>
        <button type="button" title={`stop ${name}`} aria-label="stop" onClick={() => void stopAgent()}>
          ■
        </button>
      </form>
    </section>
  );
}
