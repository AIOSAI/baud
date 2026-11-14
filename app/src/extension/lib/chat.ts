/** The side panel's chat rules, pure: feed lines and runs, file changes, the Looking-at tag, image tags, keys, tab memory. */

import type { AgentChange, AgentFeed, AgentLine, AgentUsage, UsageLimit } from "../../types";
import type { FleetEntry, LookAt, LookKind } from "../messages";
import { agentId } from "./pulseState";

export const FEED_KEEP = 1000;

/** Fold a poll in by line number: a re-sent line replaces its old self, order is by `n`. */
export function mergeLines(seen: AgentLine[], arriving: AgentLine[]): AgentLine[] {
  const byN = new Map(seen.map((l) => [l.n, l]));
  for (const l of arriving) if (Number.isFinite(l?.n)) byN.set(l.n, l);
  return [...byN.values()].sort((a, b) => a.n - b.n).slice(-FEED_KEEP);
}

export const lastN = (lines: AgentLine[]): number | undefined => lines[lines.length - 1]?.n;

/** Consecutive tool lines stack into one run; every other line is a run of one. */
export function runsOf(lines: AgentLine[]): AgentLine[][] {
  const runs: AgentLine[][] = [];
  for (const l of lines) {
    const last = runs[runs.length - 1];
    if (l.role === "tool" && last && last[0].role === "tool") last.push(l);
    else runs.push([l]);
  }
  return runs;
}

export const stamp = (time: string | number | undefined): string => {
  if (time === undefined || time === "") return "";
  const d = new Date(time);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/** The small label over a run: who, when, and on a reply the model. */
export function runLabel(run: AgentLine[], agentName: string): string {
  const l = run[run.length - 1];
  const who = l.role === "agent" ? agentName : l.role === "user" ? "you" : run.length > 1 ? `${run.length} tool calls` : "tool";
  const at = stamp(l.time);
  return who + (at ? ` · ${at}` : "") + (l.role === "agent" && l.model ? ` · ${l.model}` : "");
}

/* ---- file changes */

/** A run's totals over the lines that carry a change; null when none does. */
export function runChange(run: AgentLine[]): { added: number; removed: number } | null {
  const cs = run.flatMap((l) => (l.change ? [l.change] : []));
  return cs.length ? { added: cs.reduce((n, c) => n + c.added, 0), removed: cs.reduce((n, c) => n + c.removed, 0) } : null;
}

export interface DiffRow {
  kind: " " | "+" | "-";
  text: string;
}

const linesOf = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** Longest common subsequence over lines, removals first; the shared head and tail are cut so a big file costs its middle. */
export function lineDiff(a: string[], b: string[]): DiffRow[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const w = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  const same = (text: string): DiffRow => ({ kind: " ", text });
  const mid: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      mid.push(same(x[i++]));
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) mid.push({ kind: "-", text: x[i++] });
    else mid.push({ kind: "+", text: y[j++] });
  }
  while (i < x.length) mid.push({ kind: "-", text: x[i++] });
  while (j < y.length) mid.push({ kind: "+", text: y[j++] });
  return [...a.slice(0, head).map(same), ...mid, ...a.slice(a.length - tail).map(same)];
}

/** What the diff sheet draws: one unified hunk for the phone's differ, or the sentence saying why there is none. */
export function changeView(c: AgentChange): { patch: string } | { note: string } {
  if (c.large) return { note: "this change was too large to keep: the counts came through, the diff did not" };
  let from: string;
  let to: string;
  let start: number;
  if (typeof c.old === "string" && typeof c.new === "string") {
    if (!Number.isInteger(c.start) || c.start! < 1) return { note: "this edit came without the line it starts on, so it cannot be numbered" };
    [from, to, start] = [c.old, c.new, c.start!];
  } else if (typeof c.after === "string" && (c.before === null || typeof c.before === "string")) {
    [from, to, start] = [c.before ?? "", c.after, 1];
  } else return { note: "this change came without a body the panel can draw" };
  const rows = lineDiff(linesOf(from), linesOf(to));
  if (!rows.length) return { note: "both sides are empty: nothing to draw" };
  const olds = rows.filter((r) => r.kind !== "+").length;
  const news = rows.filter((r) => r.kind !== "-").length;
  const body = rows.map((r) => r.kind + r.text).join("\n");
  return { patch: `diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -${start},${olds} +${start},${news} @@\n${body}\n` };
}

/** Busy and the newest line is a tool call: the pulse's "acting". */
export const isActing = (feed: Pick<AgentFeed, "busy" | "lines">) => feed.busy && feed.lines[feed.lines.length - 1]?.role === "tool";

const URL_RE = /(https?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}])/;

/** A click on an http(s) link goes to `open`, never the page: a side panel and the desktop's webview do not open
    `target=_blank` themselves. Any other scheme is left alone. True when the click was taken. */
export function takeLinkClick(e: { target: EventTarget | null; preventDefault(): void }, open: (url: string) => void): boolean {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href")?.trim() ?? "";
  if (!/^https?:\/\//i.test(href)) return false;
  e.preventDefault();
  open(href);
  return true;
}

/** Text split on its http(s) URLs: odd parts are links, the rest stay text. */
export const linkParts = (text: string) => String(text).split(URL_RE).map((s, i) => ({ text: s, link: i % 2 === 1 }));

/* ---- Looking at */

/** One chip line, as the deck's content script wrote it: what first, then the page. */
export const lookText = (l: LookAt) => (l.text ? `${l.text} · ${l.title} (${l.page})` : "");

/** The deck's priority: eyes closed, only a pin; open, a selection, then a pin, then the pointer. */
export function lookPick(looks: Partial<Record<LookKind, LookAt>>, eyesOn: boolean): LookAt | null {
  const has = (k: LookKind) => (looks[k]?.text ? looks[k]! : null);
  return eyesOn ? has("selection") ?? has("pin") ?? has("pointer") : has("pin");
}

const LOOK_RE = /^\[Looking at: ([^\n]*)\]\n/;

/** The deck's first-line tag, kept to the character. */
export const withLook = (ctx: string, body: string) => (ctx ? `[Looking at: ${ctx}]\n${body}` : body);

/** A sent line's tag back off for display: the words, and the context for a tooltip. */
export function splitLook(text: string): { look: string | null; text: string } {
  const m = LOOK_RE.exec(text);
  return m ? { look: m[1], text: text.slice(m[0].length) } : { look: null, text };
}

/* ---- image tags */

/** The box shows `[Image #n]`; the agent needs the path. An unknown number stays a tag. */
export function resolveImages(text: string, images: string[], shownAs?: Map<string, string>): string {
  return text.replace(/\[Image #(\d+)\]/g, (tag, n) => {
    const path = images[Number(n) - 1];
    if (path) shownAs?.set(path, tag);
    return path ?? tag;
  });
}

/** A sent path echoes as the tag it replaced, until the panel reloads. */
export function retag(text: string, shownAs: Map<string, string>): string {
  for (const [path, tag] of shownAs) text = text.split(path).join(tag);
  return text;
}

/** The tag inserted at `at`, spaced off the word before it; the new cursor follows it. */
export function insertTag(value: string, at: number, n: number): { value: string; cursor: number } {
  const before = value.slice(0, at);
  const add = (before && !/\s$/.test(before) ? " " : "") + `[Image #${n}] `;
  return { value: before + add + value.slice(at), cursor: at + add.length };
}

export const isImage = (f: { type: string }) => f.type.startsWith("image/");

/* ---- keys */

/** Enter sends; Shift+Enter is the box's own newline; an IME composing keeps its Enter. */
export const enterSends = (e: { key: string; shiftKey: boolean; isComposing: boolean }) => e.key === "Enter" && !e.shiftKey && !e.isComposing;

/** Esc closes an open menu and nothing else; with none open it stops the open agent, as the deck's did, busy or not. */
export function escAction(menuOpen: boolean, agent: string | null): "close" | "interrupt" | "none" {
  if (menuOpen) return "close";
  return agent ? "interrupt" : "none";
}

/* ---- tabs */

/** Chat tabs are live interactive agents; a dispatched agent is background work, seen on the pulse only. */
export const chatAgents = (branches: FleetEntry[]) => branches.filter((b) => b.interactive && !b.dispatched);

export const isBusyEntry = (b: FleetEntry) => b.busy === true || b.state === "working" || b.state === "waiting";

/** A seat running a sub-agent pulses as a working one does. */
export const dotState = (b: FleetEntry) => (b.delegating || Number(b.subagents) > 0 ? "working" : b.state || "");

export const tabTitle = (b: FleetEntry) => `${b.project} · ${b.provider ?? "claude"} · ${b.state || "state unknown"}`;

export const PANEL_AGENT_KEY = "panelAgent";

/** The remembered tab while its agent is live; otherwise none shown, the memory kept for its return. */
export function shownAgent(remembered: string | null, branches: FleetEntry[]): string | null {
  return remembered && chatAgents(branches).some((b) => agentId(b) === remembered) ? remembered : null;
}

type Store = Pick<chrome.storage.StorageArea, "get" | "set">;

export const recallAgent = async (store: Store) => {
  const v = (await store.get(PANEL_AGENT_KEY))[PANEL_AGENT_KEY];
  return typeof v === "string" && v.includes("/") ? v : null;
};

export const rememberAgent = (store: Store, agent: string | null) => store.set({ [PANEL_AGENT_KEY]: agent });

/* ---- busy line */

export type BusyView =
  | { kind: "none" }
  | { kind: "busy" }
  | { kind: "waiting"; tool: string }
  | { kind: "answered"; word: string };

export interface Answered {
  at: number;
  word: string;
}

/** A denied prompt stops the turn with no new state, so after an answer "waiting" reads as idle until it changes. */
export function busyView(feed: Pick<AgentFeed, "busy" | "waiting"> | null, answered: Answered | null, now: number): BusyView {
  if (!feed) return { kind: "none" };
  if (feed.waiting) {
    if (!answered) return { kind: "waiting", tool: feed.waiting.tool ?? "" };
    return now - answered.at < 3000 ? { kind: "answered", word: answered.word } : { kind: "none" };
  }
  return feed.busy ? { kind: "busy" } : { kind: "none" };
}

export const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A refused model switch in words: 409 is the host saying the agent works, with its own sentence after. */
export function modelRefusal(err: unknown, name: string): string {
  const said = errText(err);
  return (err as { status?: number } | null)?.status === 409 ? `${name} is working; the model can change when it stops (${said})` : said;
}

/* ---- usage */

export function worstSeverity(limits: UsageLimit[] | undefined): "normal" | "warning" | "critical" {
  let worst: "normal" | "warning" | "critical" = "normal";
  for (const l of limits ?? []) {
    if (l.severity === "critical") return "critical";
    if (l.severity === "warning") worst = "warning";
  }
  return worst;
}

/** Why there is no number: the host's note, or the error that stopped the read. */
export function usageWhy(u: AgentUsage | null, error: string | null): string {
  if (error) return `usage could not be read: ${error}`;
  if (!u) return "reading…";
  return u.note ?? "";
}

/* ---- read aloud */

/** Spoken, not read: markdown marks and code fences are noise in a voice. */
export const speakable = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#`>|]/g, "");


/** A feed answer from another transcript than the one held; the first answer only names it. */
export const sessionChanged = (held: string | null, got: string | null | undefined): boolean =>
  held !== null && !!got && got !== held;
