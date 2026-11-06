/** One agent's chat on the phone: the extension side panel's feed, send, photos, pending, allow/deny, stop, read-aloud, model and usage. Reference: docs/phone/chat.md */

import DOMPurify from "dompurify";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { agentAllow, agentDeny, agentFeed, agentInterrupt, agentSend, uploadImage } from "../host";
import type { AgentLine } from "../types";
import { busyView, errText, insertTag, isImage, lastN, linkParts, mergeLines, resolveImages, retag, runLabel, runsOf, sessionChanged, type Answered } from "../extension/lib/chat";
import * as P from "../extension/lib/pending";
import { ModelMenu, UsageRing, UsageSheet, useUsage } from "./ChatMenus";
import { ReadAloud, useVoice } from "./ChatVoice";
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
  const [menu, setMenu] = useState<"model" | "usage" | null>(null);
  const [flash, setFlash] = useState<{ text: string; err: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState("");
  const sheet = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const poke = useRef<() => void>(() => undefined);
  const nextId = useRef(1);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const images = useRef<string[]>([]);
  const shownAs = useRef(new Map<string, string>());
  const { voice, said } = useVoice();
  const usage = useUsage(agent);

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
    const shown = text.trim();
    if (!shown) return;
    const sent = resolveImages(shown, images.current, shownAs.current);
    const id = nextId.current++;
    setPending((p) => P.add(p, { id, sent, shown, at: Date.now(), failed: null }));
    setText("");
    images.current = [];
    atEnd.current = true;
    void deliver(id, sent);
  };

  const resend = (p: P.Pending) => {
    setPending((all) => P.resent(all, p.id, Date.now()));
    void deliver(p.id, p.sent);
  };

  const fail = (text: string) => setFlash({ text, err: true });

  const answer = (allow: boolean) => {
    setAnswered({ at: Date.now(), word: allow ? "allowed" : "denied, and the turn stopped" });
    (allow ? agentAllow : agentDeny)(agent).then(() => poke.current(), (err: unknown) => fail(errText(err)));
  };

  const stopAgent = () => agentInterrupt(agent).then(() => poke.current(), (err: unknown) => fail(`stop: ${errText(err)}`));

  // Each upload's path waits in `images` behind an `[Image #n]` tag at the cursor; submit swaps the paths in.
  const attach = async (files: File[]) => {
    setSending(true);
    try {
      for (const f of files) {
        if (!isImage(f)) {
          fail(`images only: ${f.name} was not sent`);
          continue;
        }
        try {
          const n = images.current.push(await uploadImage(f));
          setText((v) => insertTag(v, Math.min(field.current?.selectionStart ?? v.length, v.length), n).value);
          setFlash(null);
        } catch (err) {
          fail(`upload: ${errText(err)}`);
        }
      }
    } finally {
      setSending(false);
      // Or picking the same photo twice fires no change event.
      if (picker.current) picker.current.value = "";
    }
  };

  const toggle = (n: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  const provider = usage.data?.provider ?? null;
  const model = [...lines].reverse().find((l) => l.role === "agent" && l.model)?.model ?? provider;
  const busy = busyView(feed, answered, now);
  const pickMenu = (m: "model" | "usage") => setMenu((was) => (was === m ? null : m));

  return (
    <section ref={sheet} className="baud-phone-reader baud-chat">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ {backLabel}
        </button>
        <span className="baud-phone-reader-title">{name} · chat</span>
        <button type="button" className="baud-chat-model" aria-expanded={menu === "model"} onClick={() => pickMenu("model")}>
          {model ?? "model"}
        </button>
        <UsageRing usage={usage.data} error={usage.error} onClick={() => pickMenu("usage")} />
      </header>
      {menu === "model" && (
        <ModelMenu
          agent={agent}
          name={name}
          provider={provider}
          busy={!!feed?.busy || !!feed?.waiting}
          onNote={(t, err) => {
            setFlash({ text: t, err });
            setMenu(null);
          }}
        />
      )}
      {menu === "usage" && <UsageSheet usage={usage.data} error={usage.error} />}

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
                  {stack && open.has(first) ? run.map((t) => <div key={t.n}>{linked(t.text)}</div>) : linked(l.role === "user" ? retag(l.text, shownAs.current) : l.text)}
                </div>
              )}
              {l.role === "agent" && !stack && <ReadAloud id={`${agent}#${l.n}`} text={l.text} voice={voice} said={said} />}
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
      {said.error ? (
        <p className="baud-phone-error" role="alert">
          read aloud: {said.error}
        </p>
      ) : null}
      {flash ? (
        <p className={flash.err ? "baud-phone-error" : "baud-chat-note"} role={flash.err ? "alert" : "status"}>
          {flash.text}
        </p>
      ) : null}

      {/* No `capture`: it would lock out screenshots. */}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void attach(files);
        }}
      />

      <form
        className="baud-chat-ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="button" disabled={sending} title={sending ? "sending the photo…" : "attach a photo"} aria-label="attach a photo" onClick={() => picker.current?.click()}>
          +
        </button>
        <textarea ref={field} value={text} maxLength={20000} placeholder={`Message ${name}`} onChange={(e) => setText(e.target.value)} />
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
