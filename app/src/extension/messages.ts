/** Every message between content script, service worker and side panel, with the guards each receiver runs. */

import type { BranchStatus } from "../types";

export type LookKind = "pointer" | "selection" | "pin";
export const LOOK_KINDS: readonly LookKind[] = ["pointer", "selection", "pin"];

export type OrbMode = "idle" | "listening" | "thinking" | "acting" | "speaking";

/** One Looking-at line. `text` empty means that kind was cleared; `page` is the address without query or hash. */
export interface LookAt {
  kind: LookKind;
  text: string;
  title: string;
  page: string;
  pinned: boolean;
}

/** The eyes switch (Looking-at gathering on/off) and the orb's hue, kept in chrome.storage.local under `eyes`. */
export interface Eyes {
  on: boolean;
  hue: number;
}
export const DEFAULT_EYES: Eyes = { on: true, hue: 187 };

/** A fleet entry as /v1/fleet sends it, plus the contract's new fields (absent on an older host). */
export type FleetEntry = BranchStatus & { state?: string; busy?: boolean; model?: string };

/** What a ring dot needs. */
export interface Ring {
  working: boolean;
  dispatched: boolean;
  subagents: number;
}

/** What the panel knows about the open agent; the worker turns it into the orb's mode. */
export interface OrbInputs {
  busy: boolean;
  waiting: boolean;
  /** Busy and the newest feed line is a tool line. */
  acting: boolean;
  speaking: boolean;
  /** Piper's output level, 0..1. */
  loudness: number;
}

// content -> worker, port "tab"
export type TabToWorker =
  | { type: "look"; kind: LookKind; text: string; title: string; page: string }
  | { type: "interact"; on: false }
  | { type: "ping" };

// worker -> content
export type WorkerToTab =
  | { type: "state"; mode: OrbMode; speaker: number; eyes: Eyes; interact: boolean; rings: Ring[] }
  | { type: "unpin" };

// panel -> worker, port "panel:<windowId>"
export type PanelToWorker =
  | { type: "hello" }
  | { type: "ping" }
  | { type: "agent"; agent: string | null }
  | ({ type: "orb" } & OrbInputs)
  | ({ type: "eyes" } & Eyes)
  | { type: "unpin" }
  | { type: "interact"; toggle: boolean };

// worker -> panel
export type WorkerToPanel =
  | { type: "look"; look: LookAt }
  | { type: "eyes"; eyes: Eyes }
  | { type: "interact"; on: boolean; can: boolean }
  | { type: "fleet"; branches: FleetEntry[]; error: string | null };

export const TAB_PORT = "tab";
export const PANEL_PORT_PREFIX = "panel:";
export const PING_MS = 20_000;
const TEXT_CAP = 1000;

type Obj = Record<string, unknown>;
const isObj = (m: unknown): m is Obj => typeof m === "object" && m !== null && !Array.isArray(m);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isKind = (v: unknown): v is LookKind => LOOK_KINDS.includes(v as LookKind);
const isMode = (v: unknown): v is OrbMode => ["idle", "listening", "thinking", "acting", "speaking"].includes(v as string);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A port from a top-level http(s) page of this extension's own content script. */
export function isTabSender(sender: chrome.runtime.MessageSender | undefined, runtimeId: string | undefined): boolean {
  return !!sender && !!runtimeId && sender.id === runtimeId && !!sender.tab && /^https?:\/\//.test(sender.url ?? "");
}

/** A port from this extension's own side panel page, never from a tab. */
export function isPanelSender(
  sender: chrome.runtime.MessageSender | undefined,
  runtimeId: string | undefined,
  panelUrl: string,
): boolean {
  return !!sender && !!runtimeId && sender.id === runtimeId && !sender.tab && sender.url === panelUrl;
}

export function asTabToWorker(m: unknown): TabToWorker | null {
  if (!isObj(m)) return null;
  if (m.type === "ping") return { type: "ping" };
  if (m.type === "interact" && m.on === false) return { type: "interact", on: false };
  if (m.type === "look" && isKind(m.kind) && isStr(m.text) && isStr(m.title) && isStr(m.page)) {
    return { type: "look", kind: m.kind, text: m.text.slice(0, TEXT_CAP), title: m.title.slice(0, 200), page: m.page.slice(0, TEXT_CAP) };
  }
  return null;
}

export function asWorkerToTab(m: unknown): WorkerToTab | null {
  if (!isObj(m)) return null;
  if (m.type === "unpin") return { type: "unpin" };
  if (m.type !== "state" || !isMode(m.mode) || !isNum(m.speaker) || !isBool(m.interact) || !Array.isArray(m.rings)) return null;
  const eyes = asEyes(m.eyes);
  if (!eyes) return null;
  const rings = m.rings.filter(isObj).map((r) => ({
    working: r.working === true,
    dispatched: r.dispatched === true,
    subagents: isNum(r.subagents) ? Math.max(0, Math.floor(r.subagents)) : 0,
  }));
  return { type: "state", mode: m.mode, speaker: clamp01(m.speaker), eyes, interact: m.interact, rings };
}

export function asEyes(m: unknown): Eyes | null {
  if (!isObj(m) || !isBool(m.on)) return null;
  return { on: m.on, hue: isNum(m.hue) ? ((m.hue % 360) + 360) % 360 : DEFAULT_EYES.hue };
}

export function asPanelToWorker(m: unknown): PanelToWorker | null {
  if (!isObj(m)) return null;
  switch (m.type) {
    case "hello":
    case "ping":
    case "unpin":
      return { type: m.type };
    case "agent":
      return m.agent === null || (isStr(m.agent) && m.agent.includes("/")) ? { type: "agent", agent: m.agent } : null;
    case "orb":
      if (![m.busy, m.waiting, m.acting, m.speaking].every(isBool) || !isNum(m.loudness)) return null;
      return {
        type: "orb",
        busy: m.busy as boolean,
        waiting: m.waiting as boolean,
        acting: m.acting as boolean,
        speaking: m.speaking as boolean,
        loudness: clamp01(m.loudness),
      };
    case "eyes": {
      const eyes = asEyes(m);
      return eyes ? { type: "eyes", ...eyes } : null;
    }
    case "interact":
      return isBool(m.toggle) ? { type: "interact", toggle: m.toggle } : null;
    default:
      return null;
  }
}

export function asWorkerToPanel(m: unknown): WorkerToPanel | null {
  if (!isObj(m)) return null;
  if (m.type === "look" && isObj(m.look)) {
    const l = m.look;
    if (!isKind(l.kind) || !isStr(l.text) || !isStr(l.title) || !isStr(l.page) || !isBool(l.pinned)) return null;
    return { type: "look", look: { kind: l.kind, text: l.text, title: l.title, page: l.page, pinned: l.pinned } };
  }
  if (m.type === "eyes") {
    const eyes = asEyes(m.eyes);
    return eyes ? { type: "eyes", eyes } : null;
  }
  if (m.type === "interact" && isBool(m.on) && isBool(m.can)) return { type: "interact", on: m.on, can: m.can };
  if (m.type === "fleet" && Array.isArray(m.branches) && (m.error === null || isStr(m.error))) {
    return { type: "fleet", branches: m.branches.filter(isObj) as unknown as FleetEntry[], error: m.error };
  }
  return null;
}
