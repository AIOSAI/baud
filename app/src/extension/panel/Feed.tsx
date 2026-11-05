/** The open agent's transcript: runs of lines, tool runs stacked, the panel's own notes placed among them by time.
    Text is text: only http(s) URLs become links. Nodes are keyed by line number, so a poll leaves a selection be. */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { AgentLine } from "../../types";
import { linkParts, retag, runLabel, runsOf, splitLook, stamp } from "../lib/chat";
import type { Voice, VoiceState } from "./voice";

export interface Note {
  at: number;
  text: string;
  err: boolean;
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

function Actions({ id, text, voice, said }: { id: string; text: string; voice: Voice; said: VoiceState }) {
  const [copied, setCopied] = useState(false);
  const mine = said.id === id;
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  return (
    <span className="baud-ext-acts">
      <button type="button" title={mine ? (said.paused ? "resume" : "pause") : "read it to me"} onClick={() => void voice.play(id, text)}>
        {mine ? (said.loading ? "…" : said.paused ? "▶" : "⏸") : "▶"}
      </button>
      {mine && (
        <>
          <button type="button" title="back 10 seconds" onClick={() => voice.back(10)}>
            ↺
          </button>
          <button type="button" title="stop" onClick={() => voice.stop()}>
            ■
          </button>
        </>
      )}
      <button type="button" title="copy" onClick={copy}>
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

export function Feed(props: {
  agent: string;
  lines: AgentLine[];
  notes: Note[];
  error: string | null;
  shownAs: Map<string, string>;
  voice: Voice;
  said: VoiceState;
}) {
  const { agent, lines, notes, error, shownAs, voice, said } = props;
  const name = agent.split("/")[1] ?? agent;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);

  // Sticks to the bottom only when the reader was already within 40 px of it.
  useLayoutEffect(() => {
    if (atEnd.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, notes, error]);

  const toggle = (n: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  const items: { at: number; el: ReactNode }[] = runsOf(lines).map((run) => {
    const l = run[run.length - 1];
    const first = run[0].n;
    const stack = run.length > 1;
    const shown = l.role === "user" ? splitLook(retag(l.text, shownAs)) : { look: null, text: l.text };
    const body = stack && open.has(first) ? run.map((t) => <div key={t.n}>{linked(t.text)}</div>) : linked(shown.text);
    return {
      at: Date.parse(run[0].time),
      el: (
        <div
          key={`l${first}`}
          className={`baud-ext-line baud-ext-${l.role}${stack ? " baud-ext-stack" : ""}`}
          onClick={stack ? (e) => !(e.target as Element).closest("a, button") && toggle(first) : undefined}
        >
          <small>
            {runLabel(run, name)}
            {stack && (open.has(first) ? " ▴" : " ▾")}
            {shown.look !== null && (
              <>
                {" · "}
                <em className="baud-ext-looktag" title={shown.look}>
                  looking at
                </em>
              </>
            )}
          </small>
          <div className="baud-ext-text">{body}</div>
          {l.role === "agent" && <Actions id={`${agent}#${l.n}`} text={l.text} voice={voice} said={said} />}
        </div>
      ),
    };
  });
  // The panel's own lines (a model switch, its refusal) sit among the transcript's by time.
  for (const n of notes) {
    const i = items.findIndex((x) => x.at > n.at);
    const at = stamp(n.at);
    const el = (
      <div key={`n${n.at}${n.text}`} className={`baud-ext-line baud-ext-note${n.err ? " baud-ext-err" : ""}`}>
        <small>{`panel${at ? ` · ${at}` : ""}`}</small>
        <div className="baud-ext-text">{n.text}</div>
      </div>
    );
    items.splice(i < 0 ? items.length : i, 0, { at: n.at, el });
  }

  return (
    <div
      ref={box}
      className="baud-ext-feed"
      onScroll={(e) => {
        const b = e.currentTarget;
        atEnd.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
      }}
    >
      {items.map((x) => x.el)}
      {error && <div className="baud-ext-line baud-ext-err">{error}</div>}
      {!lines.length && !error && <p className="baud-ext-dim">nothing said yet</p>}
    </div>
  );
}
