/** The side panel: agent tabs over the open agent's chat, on the host API. The deck's chat, ported; its known bugs fixed
    (Shift+Enter is a newline, Esc in a menu only closes it, the open tab is remembered). */

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import { agentAllow, agentDeny, agentFeed, agentInterrupt, agentSend, agentUsage, uploadImage } from "../../host";
import type { AgentLine, AgentUsage } from "../../types";
import { whileVisible } from "../../phone/lib/whileVisible";
import {
  busyView,
  chatAgents,
  dotState,
  enterSends,
  errText,
  escAction,
  insertTag,
  isActing,
  isBusyEntry,
  isImage,
  lastN,
  lookPick,
  lookText,
  mergeLines,
  recallAgent,
  rememberAgent,
  resolveImages,
  sessionChanged,
  shownAgent,
  tabTitle,
  withLook,
  type Answered,
} from "../lib/chat";
import { loadHost } from "../lib/hostConfig";
import { agentId } from "../lib/orbState";
import * as P from "../lib/pending";
import { DEFAULT_EYES, type Eyes, type FleetEntry, type LookAt, type LookKind, type WorkerToPanel } from "../messages";
import { holdSpace } from "./dictation";
import { Feed, type Note } from "./Feed";
import { ModelMenu, UsageRing, UsageSheet } from "./Menus";
import { connectPanel } from "./port";
import { createVoice, type VoiceState } from "./voice";
import "../../tokens/tokens.generated.css";
import "../extension.css";

/** One port and one host read for the page, outside React, so StrictMode's double mount never opens two. */
const heard = new Set<(m: WorkerToPanel) => void>();
const link = connectPanel((m) => heard.forEach((f) => f(m)));
const hostHeard = new Set<(ok: boolean) => void>();
const hostRead = loadHost((s) => hostHeard.forEach((f) => f(!!s)));
const voiceHeard = new Set<(s: VoiceState) => void>();
const voice = createVoice((s) => voiceHeard.forEach((f) => f(s)));

const FEED_MS = 2000;
const USAGE_MS = 30_000;
const ORB_MS = 40; // the speaker level, about 25 a second while a reply plays
const STAR = "·✢✳✶✻✽✻✶✳✢";
const WORDS = ["Pondering", "Noodling", "Tinkering", "Conjuring", "Mulling", "Brewing", "Scheming", "Untangling", "Rummaging",
  "Fiddling", "Whirring", "Puzzling", "Simmering", "Wrangling", "Hatching", "Sleuthing", "Marinating", "Cogitating", "Humming"];

interface FeedState {
  agent: string;
  lines: AgentLine[];
  busy: boolean;
  waiting: { tool: string } | null;
  error: string | null;
}

type Menu = { kind: "model"; agent: string } | { kind: "usage" } | null;

/** A turning star and a playful word while the agent works. */
function Star() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 120);
    return () => clearInterval(t);
  }, []);
  const word = WORDS[Math.floor(tick / 25) % WORDS.length];
  return (
    <>
      <b>{STAR[tick % STAR.length]}</b> <span>{word}…</span>
    </>
  );
}

function Panel() {
  const [host, setHost] = useState<boolean | null>(null);
  const [branches, setBranches] = useState<FleetEntry[]>([]);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [looks, setLooks] = useState<Partial<Record<LookKind, LookAt>>>({});
  const [eyes, setEyes] = useState<Eyes>(DEFAULT_EYES);
  const [interact, setInteract] = useState<{ on: boolean; can: boolean } | null>(null);
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [pending, setPending] = useState<Record<string, P.Pending[]>>({});
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [usage, setUsage] = useState<{ agent: string; data: AgentUsage | null; error: string | null } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [said, setSaid] = useState<VoiceState>(voice.state);
  const [hint, setHint] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const agent = shownAgent(remembered, branches);
  const box = useRef<HTMLTextAreaElement>(null);
  const images = useRef<string[]>([]);
  const shownAs = useRef(new Map<string, string>());
  const nextId = useRef(1);
  const feedRef = useRef<FeedState | null>(null);
  const poke = useRef<() => void>(() => undefined);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  feedRef.current = feed;

  const tellOrb = useCallback(() => {
    const f = feedRef.current;
    const s = voice.state;
    link.send({
      type: "orb",
      busy: !!f?.busy,
      waiting: !!f?.waiting,
      acting: f ? isActing(f) : false,
      speaking: s.id !== null && !s.loading && !s.paused,
      loudness: voice.level(),
    });
  }, []);

  // the worker, the host settings, the voice, the remembered tab
  useEffect(() => {
    const hear = (m: WorkerToPanel) => {
      if (m.type === "look") setLooks((was) => ({ ...was, [m.look.kind]: m.look.text ? m.look : undefined }));
      else if (m.type === "interact") setInteract({ on: m.on, can: m.can });
      else if (m.type === "fleet") {
        setBranches(m.branches);
        setFleetError(m.error);
      } else if (m.type === "eyes") {
        setEyes(m.eyes);
        if (!m.eyes.on) setLooks((was) => ({ pin: was.pin }));
        link.send({ type: "agent", agent: agentRef.current }); // eyes answer a hello: a restarted worker learns the tab again
      }
    };
    heard.add(hear);
    hostHeard.add(setHost);
    voiceHeard.add(setSaid);
    void hostRead.then((s) => setHost(!!s));
    void recallAgent(chrome.storage.local).then(setRemembered);
    link.send({ type: "hello" });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      heard.delete(hear);
      hostHeard.delete(setHost);
      voiceHeard.delete(setSaid);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => link.send({ type: "agent", agent }), [agent]);

  // the open agent's feed, incremental by line number, while the panel shows
  useEffect(() => {
    setFeed(null);
    setAnswered(null);
    if (!agent || !host) return;
    let alive = true;
    let lines: AgentLine[] = [];
    let session: string | null = null;
    const tick = async (): Promise<void> => {
      try {
        const f = await agentFeed(agent, lastN(lines));
        if (!alive) return;
        if (sessionChanged(session, f?.session)) {
          // A new transcript numbers its lines from 0 again: what was asked `since` an old n says nothing.
          session = f.session ?? null;
          lines = [];
          return tick();
        }
        session = f?.session ?? session;
        lines = mergeLines(lines, Array.isArray(f?.lines) ? f.lines : []);
        const next = { agent, lines, busy: !!f.busy, waiting: f.waiting ?? null, error: null };
        feedRef.current = next;
        setFeed(next);
        if (!next.waiting) setAnswered(null);
        setPending((p) => (p[agent] ? { ...p, [agent]: P.settle(p[agent], lines) } : p));
      } catch (err) {
        if (!alive) return;
        setFeed((was) => ({ agent, lines, busy: was?.busy ?? false, waiting: was?.waiting ?? null, error: errText(err) }));
      }
      tellOrb();
    };
    poke.current = () => setTimeout(() => void tick(), 600);
    const stop = whileVisible(() => void tick(), FEED_MS);
    return () => {
      alive = false;
      stop();
    };
  }, [agent, host, tellOrb]);

  // usage on tab open and every 30 s
  useEffect(() => {
    setUsage(null);
    if (!agent || !host) return;
    let alive = true;
    const stop = whileVisible(() => {
      agentUsage(agent).then(
        (data) => alive && setUsage({ agent, data, error: null }),
        (err: unknown) => alive && setUsage({ agent, data: null, error: errText(err) }),
      );
    }, USAGE_MS);
    return () => {
      alive = false;
      stop();
    };
  }, [agent, host]);

  // the orb hears the reader's level while a reply plays
  useEffect(() => {
    tellOrb();
    if (said.id === null || said.loading || said.paused) return;
    const t = setInterval(tellOrb, ORB_MS);
    return () => clearInterval(t);
  }, [said, tellOrb]);

  const stopAgent = useCallback(() => {
    const a = agentRef.current;
    if (a) agentInterrupt(a).then(() => poke.current(), (err: unknown) => setFlash(`stop: ${errText(err)}`));
  }, []);

  // Esc: an open menu closes and nothing else; otherwise the open agent stops
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat) return;
      const act = escAction(menu !== null, agentRef.current);
      if (act === "close") setMenu(null);
      else if (act === "interrupt") stopAgent();
    };
    const onDown = (e: PointerEvent) => {
      if (menu && !(e.target as Element).closest?.(".baud-ext-menu, .baud-ext-arw, .baud-ext-ring")) setMenu(null);
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
    };
  }, [menu, stopAgent]);

  useEffect(
    () =>
      holdSpace(
        () => box.current,
        (s) => {
          setListening(s.listening);
          if (s.hint !== undefined) setHint(s.hint);
        },
      ),
    [],
  );

  // a dropped file never replaces the panel
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    document.addEventListener("dragover", stop);
    document.addEventListener("drop", stop);
    return () => {
      document.removeEventListener("dragover", stop);
      document.removeEventListener("drop", stop);
    };
  }, []);

  const openTab = (a: string | null) => {
    setRemembered(a);
    setMenu(null);
    void rememberAgent(chrome.storage.local, a);
  };

  const note = (a: string, text: string, err: boolean) => {
    setNotes((n) => ({ ...n, [a]: [...(n[a] ?? []), { at: Date.now(), text, err }] }));
    setMenu(null);
    if (a !== agentRef.current) openTab(a);
  };

  const deliver = (a: string, id: number, sent: string) =>
    agentSend(a, sent).then(
      () => poke.current(),
      (err: unknown) => setPending((p) => ({ ...p, [a]: P.failed(p[a] ?? [], id, errText(err)) })),
    );

  const pick = lookPick(looks, eyes.on);
  const lookLine = pick ? lookText(pick) : "";

  const submit = () => {
    const input = box.current;
    const text = input?.value.trim() ?? "";
    if (!input || !text || !agent) return;
    const sent = withLook(lookLine, resolveImages(text, images.current, shownAs.current));
    const id = nextId.current++;
    setPending((p) => ({ ...p, [agent]: P.add(p[agent] ?? [], { id, sent, shown: text, at: Date.now(), failed: null }) }));
    input.value = "";
    images.current = [];
    if (lookLine) setLooks((was) => ({ pin: was.pin })); // sent: the selection and pointer are spent, a pin stays
    void deliver(agent, id, sent);
  };

  const resend = (p: P.Pending) => {
    if (!agent) return;
    setPending((all) => ({ ...all, [agent]: P.resent(all[agent] ?? [], p.id, Date.now()) }));
    void deliver(agent, p.id, p.sent);
  };

  const attach = async (files: File[]) => {
    const input = box.current;
    if (!input) return;
    for (const f of files) {
      if (!isImage(f)) {
        setFlash(`images only: ${f.name} was not sent`);
        continue;
      }
      try {
        const path = await uploadImage(f);
        const put = insertTag(input.value, input.selectionStart ?? input.value.length, images.current.push(path));
        input.value = put.value;
        input.focus();
        input.setSelectionRange(put.cursor, put.cursor);
        setFlash(null);
      } catch (err) {
        setFlash(`upload: ${errText(err)}`);
      }
    }
  };

  // captureVisibleTab needs <all_urls> (activeTab is granted only by the toolbar click); request answers true at once, no prompt, when it is already held.
  const shoot = async () => {
    try {
      if (!(await chrome.permissions.request({ origins: ["<all_urls>"] }))) {
        setFlash("screenshot: page access not granted");
        return;
      }
      const win = await chrome.windows.getCurrent();
      const shot = await chrome.tabs.captureVisibleTab(win.id, { format: "png" });
      const blob = await (await fetch(shot)).blob();
      await attach([new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" })]);
    } catch (err) {
      setFlash(`screenshot: ${errText(err)}`);
    }
  };

  const unpin = () => {
    if (looks.pin) link.send({ type: "unpin" });
    setLooks((was) => ({ ...was, pin: undefined }));
  };

  const toggleEyes = () => {
    const next = { on: !eyes.on, hue: eyes.hue };
    setEyes(next);
    if (!next.on) setLooks((was) => ({ pin: was.pin }));
    link.send({ type: "eyes", ...next });
  };

  const answer = (allow: boolean) => {
    if (!agent) return;
    setAnswered({ at: Date.now(), word: allow ? "allowed" : "denied, and the turn stopped" });
    (allow ? agentAllow : agentDeny)(agent).then(() => poke.current(), (err: unknown) => setFlash(errText(err)));
  };

  const tabs = chatAgents(branches);
  const name = agent?.split("/")[1] ?? "";
  const live = feed?.agent === agent ? feed : null;
  const busy = busyView(live, answered, now);
  const waitingList = (agent && pending[agent]) || [];
  const menuEntry = menu?.kind === "model" ? tabs.find((b) => agentId(b) === menu.agent) : undefined;

  return (
    <main
      className="baud-ext-panel baud-ext-chat"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void attach([...e.dataTransfer.files]);
      }}
    >
      <header className="baud-ext-head">
        <div className="baud-ext-row">
          {agent && <UsageRing usage={usage?.data ?? null} error={usage?.error ?? null} onClick={() => setMenu(menu?.kind === "usage" ? null : { kind: "usage" })} />}
          <button
            type="button"
            role="switch"
            aria-checked={eyes.on}
            className={eyes.on ? "baud-ext-on" : ""}
            title={eyes.on ? "Looking at: on. What you point at, select, or pin the orb on goes with your next message. Click to close his eyes: then only a pin goes." : "Looking at: off. Only what you pin the orb on goes with your messages. Click to open his eyes."}
            onClick={toggleEyes}
          >
            {eyes.on ? "◉ eyes" : "◡ eyes"}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={!!interact?.on}
            disabled={!interact?.can}
            title={!interact?.can ? "Interact: no BAUD script answers in this tab. Reload it; chrome:// pages and files never run it." : interact.on ? "Interact: on. The orb is on this tab. Click to take it off." : "Interact: off. Click to put the orb on this tab."}
            onClick={() => link.send({ type: "interact", toggle: true })}
          >
            {interact?.on ? "interact: on" : "interact: off"}
          </button>
          <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
            host
          </button>
        </div>
        <nav className="baud-ext-tabs">
          {tabs.map((b) => {
            const id = agentId(b);
            const working = isBusyEntry(b);
            return (
              <span key={id} className={`baud-ext-tab${id === agent ? " baud-ext-on" : ""}`} title={tabTitle(b)}>
                <button type="button" onClick={() => openTab(id)}>
                  <i className={`baud-ext-dot baud-ext-dot-${dotState(b) || "unknown"}`} />
                  {b.name}
                </button>
                <button
                  type="button"
                  className="baud-ext-arw"
                  title={working ? "working; try when idle" : "switch model"}
                  onClick={() => (working ? note(id, `${b.name} is working; the model can change when it stops`, false) : setMenu({ kind: "model", agent: id }))}
                >
                  {working ? "✻" : "▾"}
                </button>
              </span>
            );
          })}
        </nav>
        {menuEntry && <ModelMenu key={menu?.kind === "model" ? menu.agent : ""} entry={menuEntry} onNote={(t, err) => note(agentId(menuEntry), t, err)} />}
        {menu?.kind === "usage" && <UsageSheet usage={usage?.data ?? null} error={usage?.error ?? null} />}
      </header>

      {host === false && (
        <p className="baud-ext-err">
          No host set. <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>set the host</button>
        </p>
      )}
      {fleetError && <p className="baud-ext-err">fleet: {fleetError}</p>}
      {host && !fleetError && !tabs.length && <p className="baud-ext-dim">no agent is live</p>}

      {agent ? (
        <Feed agent={agent} lines={live?.lines ?? []} notes={notes[agent] ?? []} error={live?.error ?? null} shownAs={shownAs.current} voice={voice} said={said} />
      ) : (
        <div className="baud-ext-feed">{tabs.length > 0 && <p className="baud-ext-dim">open an agent's tab to talk to it</p>}</div>
      )}
      {said.error && <p className="baud-ext-err">read aloud: {said.error}</p>}

      {lookLine && pick && (
        <div className="baud-ext-looking" title={lookLine}>
          <span>Looking at: {lookLine}</span>
          {looks.pin && !(eyes.on && pick.kind === "selection") && (
            <button type="button" title="pinned: click to unpin" onClick={unpin}>
              ◉
            </button>
          )}
          <button
            type="button"
            title="clear"
            onClick={() => {
              setLooks({});
              if (looks.pin) link.send({ type: "unpin" });
            }}
          >
            ×
          </button>
        </div>
      )}

      {waitingList.length > 0 && (
        <div className="baud-ext-pending">
          {waitingList.map((p) => {
            const look = P.lookOf(p, now);
            return (
              <div key={p.id} className={`baud-ext-pend baud-ext-pend-${look}`}>
                <small>
                  {look === "waiting" ? `sent · waiting for ${name}` : look === "stale" ? `not delivered to ${name} · ` : `not sent: ${p.failed} · `}
                  {look !== "waiting" && (
                    <>
                      <button type="button" className="baud-ext-link" onClick={() => resend(p)}>
                        resend
                      </button>
                      {" · "}
                      <button
                        type="button"
                        className="baud-ext-link"
                        onClick={() => setPending((all) => ({ ...all, [agent!]: P.discard(all[agent!] ?? [], p.id) }))}
                      >
                        discard
                      </button>
                    </>
                  )}
                </small>
                <div>{p.shown}</div>
              </div>
            );
          })}
        </div>
      )}

      {busy.kind !== "none" && (
        <div className="baud-ext-busy">
          {busy.kind === "busy" && <Star />}
          {busy.kind === "answered" && (
            <>
              <b>✓</b> <span>{busy.word}</span>
            </>
          )}
          {busy.kind === "waiting" && (
            <>
              <b>!</b> <span>waiting for your permission{busy.tool ? `: ${busy.tool}` : ""}</span>
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

      {flash && <p className="baud-ext-err">{flash}</p>}
      <form
        className="baud-ext-ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={box}
          className={listening ? "baud-ext-listening" : ""}
          maxLength={20000}
          disabled={!agent}
          placeholder={hint ?? (agent ? `Message ${name} · hold Space to talk` : "open an agent's tab")}
          onKeyDown={(e) => {
            if (!enterSends(e.nativeEvent)) return;
            e.preventDefault();
            submit();
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter(isImage);
            if (!files.length) return;
            e.preventDefault();
            void attach(files);
          }}
        />
        <button type="button" title="screenshot this tab into the message" disabled={!agent} onClick={() => void shoot()}>
          ◫
        </button>
        <button type="submit" title="Send to the agent" disabled={!agent}>
          ➤
        </button>
        {agent && (
          <button type="button" title="stop the agent (Esc)" onClick={stopAgent}>
            ■
          </button>
        )}
      </form>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
