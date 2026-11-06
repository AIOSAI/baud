/** The tab arrow's model menu and the usage ring's sheet, as the deck drew them. */

import { useEffect, useState } from "react";

import { agentModel, modelsList } from "../../host";
import type { AgentUsage, ModelCatalog, ModelRow } from "../../types";
import { isBusyEntry, modelRefusal, usageWhy, worstSeverity } from "../lib/chat";
import type { FleetEntry } from "../messages";
import { agentId } from "../lib/orbState";

export const PROVIDERS = { claude: "Claude", codex: "Codex", opencode: "OpenCode" } as const;
export type Provider = keyof typeof PROVIDERS;

export const nameOf = (m: ModelRow) => m.label || (m.group ? m.name.slice(m.group.length + 1) : (m.name[0] ?? "").toUpperCase() + m.name.slice(1));

/** Under its own provider a pick switches model (and effort); another provider's chip is a handoff to that CLI. */
export function ModelMenu({ entry, onNote }: { entry: FleetEntry; onNote: (text: string, err: boolean) => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = (entry.provider ?? "claude") as Provider;
  const [view, setView] = useState<Provider>(mine);
  const [note, setNote] = useState("");
  const busy = isBusyEntry(entry);
  const agent = agentId(entry);

  useEffect(() => {
    modelsList().then(setCatalog, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const post = (pick: { provider: string; model?: string; effort?: string }, to: string, done: (typed: string) => string) => {
    setNote("typing…");
    agentModel(agent, pick).then(
      (d) => onNote(done(d?.typed ? `, typed ${d.typed}` : ""), false),
      (err: unknown) => onNote(`could not switch ${entry.name} to ${to}: ${modelRefusal(err, entry.name)}`, true),
    );
  };
  const pick = (model: string, effort: string | null, label: string) => {
    const to = label + (effort ? ` ${effort}` : "");
    post({ provider: mine, model, ...(effort ? { effort } : {}) }, to, (typed) => `switched ${entry.name} to ${to}${typed}; pending its next reply`);
  };
  const move = (model: string | null, label: string | null) => {
    const to = PROVIDERS[view] + (label ? ` (${label})` : "");
    post({ provider: view, ...(model ? { model } : {}) }, to, (typed) => `switching ${entry.name} to ${to}${typed}; the tab returns when the new room is live`);
  };

  const takes = catalog?.switch?.[mine]?.[view];
  const p = error ? { models: [], reason: error } : (catalog?.[view] ?? { models: [], reason: catalog ? `no model list for ${view}` : "reading…" });
  const typed = !busy && (view === mine ? mine !== "opencode" : !!takes);
  let group: string | undefined;

  return (
    <div className="baud-ext-menu" role="menu">
      <div className="baud-ext-prov">
        {(Object.keys(PROVIDERS) as Provider[]).map((k) => (
          <button
            key={k}
            type="button"
            className={k === mine ? "baud-ext-on" : k === view ? "baud-ext-view" : ""}
            title={k === mine ? "current" : `switch ${entry.name} to ${PROVIDERS[k]}`}
            onClick={() => setView(k)}
          >
            {PROVIDERS[k]}
          </button>
        ))}
      </div>
      {view !== mine && (
        <button type="button" className="baud-ext-row-btn" disabled={busy} onClick={() => move(null, null)}>
          Switch to {PROVIDERS[view]} <small>{takes ? "its default model" : "it picks its model"}</small>
        </button>
      )}
      {(view === mine || takes ? p.models : []).map((m) => {
        const head = m.group && m.group !== group ? (group = m.group) : null;
        const label = nameOf(m);
        return (
          <div key={m.name}>
            {head && <small className="baud-ext-dim">{head}/</small>}
            <div className="baud-ext-model">
              <button type="button" className="baud-ext-row-btn" disabled={!typed} onClick={() => (view === mine ? pick(m.name, null, label) : move(m.name, label))}>
                {label}
                {view === mine && mine === "opencode" && <small> picker only</small>}
              </button>
              {view === mine &&
                (m.efforts ?? []).map((e) => (
                  <button key={e} type="button" className="baud-ext-effort" disabled={!typed} onClick={() => pick(m.name, e, label)}>
                    {e}
                  </button>
                ))}
            </div>
          </div>
        );
      })}
      {view === mine && !p.models.length && <small className="baud-ext-dim">{p.reason || "no models"}</small>}
      <small className="baud-ext-dim">{busy ? "working; try when idle" : note}</small>
    </div>
  );
}

export const AROUND = 2 * Math.PI * 7;

export function UsageRing({ usage, error, onClick }: { usage: AgentUsage | null; error: string | null; onClick: () => void }) {
  const c = usage?.context ?? null;
  const why = usageWhy(usage, error);
  return (
    <button
      type="button"
      className={`baud-ext-ring${c ? "" : " baud-ext-dimmed"}`}
      data-severity={worstSeverity(usage?.limits)}
      title={c ? `context ${c.percent}% used` : why || "usage"}
      aria-label="usage"
      onClick={onClick}
    >
      <svg viewBox="0 0 18 18" width="18" height="18">
        <circle className="baud-ext-ring-track" cx="9" cy="9" r="7" />
        <circle className="baud-ext-ring-fill" cx="9" cy="9" r="7" strokeDasharray={`${c ? (AROUND * Math.min(c.percent, 100)) / 100 : 0} ${AROUND}`} />
      </svg>
    </button>
  );
}

function Row({ label, percent, sub, severity }: { label: string; percent: number; sub: string; severity?: string }) {
  return (
    <div className="baud-ext-urow">
      <b>{label}</b> <span>{percent}%</span>
      <progress max={100} value={Math.min(percent, 100)} data-severity={severity ?? "normal"} />
      <small className="baud-ext-dim">{sub}</small>
    </div>
  );
}

export const resets = (iso?: string | null) =>
  iso ? `Resets ${new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}` : "reset time not given";

export function UsageSheet({ usage, error }: { usage: AgentUsage | null; error: string | null }) {
  const c = usage?.context ?? null;
  const why = usageWhy(usage, error);
  return (
    <div className="baud-ext-menu" role="dialog" aria-label="usage">
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
      {why && <small className={error ? "baud-ext-err" : "baud-ext-dim"}>{why}</small>}
    </div>
  );
}
