/** The chat's model menu and usage ring and sheet: the extension's (panel/Menus.tsx), shaped for touch. Reference: docs/phone/chat.md */

import { useEffect, useState } from "react";

import { agentModel, agentUsage, modelsList } from "../host";
import type { AgentUsage, ModelCatalog } from "../types";
import { errText, modelRefusal, usageWhy, worstSeverity } from "../extension/lib/chat";
import { AROUND, nameOf, PROVIDERS, resets, type Provider } from "../extension/panel/Menus";
import { whileVisible } from "./lib/whileVisible";

const USAGE_MS = 30_000;

/** The agent's usage, read on open and every 30 s while the page shows; a failed read keeps the last numbers. */
export function useUsage(agent: string): { data: AgentUsage | null; error: string | null } {
  const [usage, setUsage] = useState<{ data: AgentUsage | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    const stop = whileVisible(() => {
      agentUsage(agent).then(
        (data) => alive && setUsage({ data, error: null }),
        (err: unknown) => alive && setUsage((was) => ({ data: was.data, error: errText(err) })),
      );
    }, USAGE_MS);
    return () => {
      alive = false;
      stop();
    };
  }, [agent]);
  return usage;
}

interface ModelMenuProps {
  agent: string;
  name: string;
  provider: string | null | undefined;
  busy: boolean;
  onNote: (text: string, err: boolean) => void;
}

/** Under its own provider a pick switches model (and effort); another provider's chip is a handoff to that CLI. */
export function ModelMenu({ agent, name, provider, busy, onNote }: ModelMenuProps) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = (provider ?? "claude") as Provider;
  const [view, setView] = useState<Provider>(mine);
  const [note, setNote] = useState("");

  useEffect(() => {
    modelsList().then(setCatalog, (err: unknown) => setError(errText(err)));
  }, []);

  const post = (pick: { provider: string; model?: string; effort?: string }, to: string, done: (typed: string) => string) => {
    setNote("typing…");
    agentModel(agent, pick).then(
      (d) => onNote(done(d?.typed ? `, typed ${d.typed}` : ""), false),
      (err: unknown) => onNote(`could not switch ${name} to ${to}: ${modelRefusal(err, name)}`, true),
    );
  };
  const pick = (model: string, effort: string | null, label: string) => {
    const to = label + (effort ? ` ${effort}` : "");
    post({ provider: mine, model, ...(effort ? { effort } : {}) }, to, (typed) => `switched ${name} to ${to}${typed}; pending its next reply`);
  };
  const move = (model: string | null, label: string | null) => {
    const to = PROVIDERS[view] + (label ? ` (${label})` : "");
    post({ provider: view, ...(model ? { model } : {}) }, to, (typed) => `switching ${name} to ${to}${typed}; the chat returns when the new room is live`);
  };

  const takes = catalog?.switch?.[mine]?.[view];
  const p = error ? { models: [], reason: error } : (catalog?.[view] ?? { models: [], reason: catalog ? `no model list for ${view}` : "reading…" });
  const typed = !busy && (view === mine ? mine !== "opencode" : !!takes);
  let group: string | undefined;

  return (
    <div className="baud-chat-menu" role="menu" aria-label="model">
      <div className="baud-chat-prov">
        {(Object.keys(PROVIDERS) as Provider[]).map((k) => (
          <button key={k} type="button" className={k === mine ? "baud-chat-on" : k === view ? "baud-chat-view" : ""} onClick={() => setView(k)}>
            {PROVIDERS[k]}
          </button>
        ))}
      </div>
      {view !== mine && (
        <button type="button" className="baud-chat-row" disabled={busy} onClick={() => move(null, null)}>
          Switch to {PROVIDERS[view]} <small>{takes ? "its default model" : "it picks its model"}</small>
        </button>
      )}
      {(view === mine || takes ? p.models : []).map((m) => {
        const head = m.group && m.group !== group ? (group = m.group) : null;
        const label = nameOf(m);
        return (
          <div key={m.name}>
            {head && <small>{head}/</small>}
            <button type="button" className="baud-chat-row" disabled={!typed} onClick={() => (view === mine ? pick(m.name, null, label) : move(m.name, label))}>
              {label}
              {view === mine && mine === "opencode" && <small> picker only</small>}
            </button>
            {view === mine && !!m.efforts?.length && (
              <div className="baud-chat-efforts">
                {m.efforts.map((e) => (
                  <button key={e} type="button" disabled={!typed} onClick={() => pick(m.name, e, label)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {view === mine && !p.models.length && <small>{p.reason || "no models"}</small>}
      <small>{busy ? "working; try when idle" : note}</small>
    </div>
  );
}

export function UsageRing({ usage, error, onClick }: { usage: AgentUsage | null; error: string | null; onClick: () => void }) {
  const c = usage?.context ?? null;
  return (
    <button
      type="button"
      className={`baud-chat-ring${c ? "" : " baud-chat-dimmed"}`}
      data-severity={worstSeverity(usage?.limits)}
      title={c ? `context ${c.percent}% used` : usageWhy(usage, error) || "usage"}
      aria-label="usage"
      onClick={onClick}
    >
      <svg viewBox="0 0 18 18" width="22" height="22">
        <circle className="baud-chat-ring-track" cx="9" cy="9" r="7" />
        <circle className="baud-chat-ring-fill" cx="9" cy="9" r="7" strokeDasharray={`${c ? (AROUND * Math.min(c.percent, 100)) / 100 : 0} ${AROUND}`} />
      </svg>
    </button>
  );
}

function Row({ label, percent, sub, severity }: { label: string; percent: number; sub: string; severity?: string }) {
  return (
    <div className="baud-chat-urow">
      <b>{label}</b> <span>{percent}%</span>
      <progress max={100} value={Math.min(percent, 100)} data-severity={severity ?? "normal"} />
      <small>{sub}</small>
    </div>
  );
}

export function UsageSheet({ usage, error }: { usage: AgentUsage | null; error: string | null }) {
  const c = usage?.context ?? null;
  const why = usageWhy(usage, error);
  return (
    <div className="baud-chat-menu" role="dialog" aria-label="usage">
      <small>Usage</small>
      {c && <Row label="Context window" percent={c.percent} sub={`${(c.used / 1000).toFixed(1)}k of ${Math.round(c.total / 1000)}k tokens`} />}
      {!!usage?.limits?.length && (
        <>
          <small>Plan limits</small>
          {usage.limits.map((l) => (
            <Row key={l.label} label={l.label} percent={l.percent} sub={resets(l.resets_at)} severity={l.severity} />
          ))}
        </>
      )}
      {why && <small className={error ? "baud-chat-err" : ""}>{why}</small>}
    </div>
  );
}
