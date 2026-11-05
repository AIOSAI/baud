import { describe, expect, it } from "vitest";

import type { AgentLine } from "../../types";
import type { FleetEntry, LookAt } from "../messages";
import {
  busyView,
  chatAgents,
  enterSends,
  escAction,
  insertTag,
  isActing,
  linkParts,
  lookPick,
  lookText,
  mergeLines,
  modelRefusal,
  recallAgent,
  rememberAgent,
  resolveImages,
  retag,
  runLabel,
  runsOf,
  shownAgent,
  speakable,
  splitLook,
  stamp,
  sessionChanged,
  usageWhy,
  withLook,
  worstSeverity,
} from "./chat";

const T = "2026-11-05T10:07:00Z";
const line = (n: number, role: AgentLine["role"], text = `l${n}`, model?: string): AgentLine => ({ n, role, text, time: T, ...(model ? { model } : {}) });
const look = (kind: LookAt["kind"], text: string): LookAt => ({ kind, text, title: "Docs", page: "https://x.dev/a", pinned: kind === "pin" });
const entry = (over: Partial<FleetEntry>): FleetEntry => ({ name: "api", project: "aipass", interactive: true, dispatched: false, subagents: 0, ...over }) as FleetEntry;

describe("feed lines", () => {
  it("merges polls by line number, a re-sent line replacing itself", () => {
    const merged = mergeLines([line(1, "user"), line(2, "agent")], [line(2, "agent", "edited"), line(3, "tool")]);
    expect(merged.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(merged[1].text).toBe("edited");
  });

  it("collapses consecutive tool lines into one run", () => {
    const runs = runsOf([line(1, "user"), line(2, "tool"), line(3, "tool"), line(4, "agent"), line(5, "tool")]);
    expect(runs.map((r) => r.map((l) => l.n))).toEqual([[1], [2, 3], [4], [5]]);
  });

  it("labels who, when and the reply's model", () => {
    const at = stamp(T);
    expect(at).not.toBe("");
    expect(runLabel([line(1, "agent", "hi", "opus")], "api")).toBe(`api · ${at} · opus`);
    expect(runLabel([line(1, "user", "hi", "opus")], "api")).toBe(`you · ${at}`);
    expect(runLabel([line(1, "tool"), line(2, "tool")], "api")).toBe(`2 tool calls · ${at}`);
    expect(runLabel([{ ...line(1, "tool"), time: "" }], "api")).toBe("tool");
    expect(stamp("not a time")).toBe("");
  });

  it("is acting only while busy with a tool line newest", () => {
    expect(isActing({ busy: true, lines: [line(1, "agent"), line(2, "tool")] })).toBe(true);
    expect(isActing({ busy: false, lines: [line(2, "tool")] })).toBe(false);
    expect(isActing({ busy: true, lines: [line(2, "agent")] })).toBe(false);
  });

  it("links http(s) URLs only, trailing punctuation left out", () => {
    const parts = linkParts("see https://a.dev/x. and javascript:alert(1)");
    expect(parts.filter((p) => p.link).map((p) => p.text)).toEqual(["https://a.dev/x"]);
    expect(parts.map((p) => p.text).join("")).toBe("see https://a.dev/x. and javascript:alert(1)");
  });
});

describe("Looking at", () => {
  const looks = { pointer: look("pointer", "Install"), selection: look("selection", 'Selected: "npm i"'), pin: look("pin", "Pricing") };

  it("picks selection, then pin, then pointer; eyes closed, only the pin", () => {
    expect(lookPick(looks, true)?.kind).toBe("selection");
    expect(lookPick({ pointer: looks.pointer, pin: looks.pin }, true)?.kind).toBe("pin");
    expect(lookPick({ pointer: looks.pointer }, true)?.kind).toBe("pointer");
    expect(lookPick({ pointer: looks.pointer, selection: looks.selection }, false)).toBeNull();
    expect(lookPick(looks, false)?.kind).toBe("pin");
  });

  it("writes the deck's line and first-line tag, and reads the tag back", () => {
    expect(lookText(looks.pointer)).toBe("Install · Docs (https://x.dev/a)");
    const sent = withLook(lookText(looks.pointer), "what is this?");
    expect(sent).toBe("[Looking at: Install · Docs (https://x.dev/a)]\nwhat is this?");
    expect(splitLook(sent)).toEqual({ look: "Install · Docs (https://x.dev/a)", text: "what is this?" });
    expect(withLook("", "plain")).toBe("plain");
    expect(splitLook("plain")).toEqual({ look: null, text: "plain" });
  });
});

describe("image tags", () => {
  it("resolves tags to paths and echoes the tag back", () => {
    const shown = new Map<string, string>();
    const body = resolveImages("look [Image #1] and [Image #3]", ["/up/a.png"], shown);
    expect(body).toBe("look /up/a.png and [Image #3]");
    expect(retag(body, shown)).toBe("look [Image #1] and [Image #3]");
  });

  it("inserts a tag at the cursor, spaced", () => {
    expect(insertTag("hello world", 5, 1)).toEqual({ value: "hello [Image #1]  world", cursor: 17 });
    expect(insertTag("", 0, 2)).toEqual({ value: "[Image #2] ", cursor: 11 });
  });
});

describe("keys", () => {
  it("sends on Enter, keeps Shift+Enter and IME Enter for the box", () => {
    expect(enterSends({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    expect(enterSends({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    expect(enterSends({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(enterSends({ key: "a", shiftKey: false, isComposing: false })).toBe(false);
  });

  it("Esc closes an open menu and stops nothing; with no menu it stops the open agent", () => {
    expect(escAction(true, "aipass/api")).toBe("close");
    expect(escAction(false, "aipass/api")).toBe("interrupt");
    expect(escAction(false, null)).toBe("none");
    expect(escAction(true, null)).toBe("close");
  });
});

describe("tabs", () => {
  const fleet = [entry({ name: "api" }), entry({ name: "bg", dispatched: true }), entry({ name: "zz", interactive: false })];

  it("lists live interactive agents only", () => {
    expect(chatAgents(fleet).map((b) => b.name)).toEqual(["api"]);
  });

  it("shows the remembered tab while its agent is live and keeps the memory when it is not", () => {
    expect(shownAgent("aipass/api", fleet)).toBe("aipass/api");
    expect(shownAgent("aipass/bg", fleet)).toBeNull();
    expect(shownAgent(null, fleet)).toBeNull();
  });

  it("remembers the open tab in extension storage", async () => {
    const held: Record<string, unknown> = {};
    const store = { get: async (k: string | string[]) => ({ [k as string]: held[k as string] }), set: async (v: Record<string, unknown>) => void Object.assign(held, v) };
    expect(await recallAgent(store)).toBeNull();
    await rememberAgent(store, "aipass/api");
    expect(await recallAgent(store)).toBe("aipass/api");
    held.panelAgent = "garbage";
    expect(await recallAgent(store)).toBeNull();
  });
});

describe("busy line", () => {
  it("names the tool while waiting, and reads an answered prompt as idle after 3 s", () => {
    const waiting = { busy: true, waiting: { tool: "Bash" } };
    expect(busyView(waiting, null, 0)).toEqual({ kind: "waiting", tool: "Bash" });
    expect(busyView(waiting, { at: 0, word: "allowed" }, 1000)).toEqual({ kind: "answered", word: "allowed" });
    expect(busyView(waiting, { at: 0, word: "allowed" }, 4000)).toEqual({ kind: "none" });
    expect(busyView({ busy: true, waiting: null }, null, 0)).toEqual({ kind: "busy" });
    expect(busyView({ busy: false, waiting: null }, null, 0)).toEqual({ kind: "none" });
    expect(busyView(null, null, 0)).toEqual({ kind: "none" });
  });
});

describe("usage and refusals", () => {
  it("colours by the worst limit", () => {
    expect(worstSeverity([{ label: "a", percent: 80, severity: "warning" }, { label: "b", percent: 95, severity: "critical" }])).toBe("critical");
    expect(worstSeverity([{ label: "a", percent: 80, severity: "warning" }])).toBe("warning");
    expect(worstSeverity(undefined)).toBe("normal");
  });

  it("drops `since` only when the transcript changes", () => {
    expect(sessionChanged(null, "s1")).toBe(false);
    expect(sessionChanged("s1", "s1")).toBe(false);
    expect(sessionChanged("s1", undefined)).toBe(false);
    expect(sessionChanged("s1", "s2")).toBe(true);
  });

  it("says why there is no number", () => {
    expect(usageWhy({ context: null, note: "no reply yet" }, null)).toBe("no reply yet");
    expect(usageWhy({ context: null, limits: [] }, null)).toBe("");
    expect(usageWhy(null, "HTTP 500")).toBe("usage could not be read: HTTP 500");
    expect(usageWhy(null, null)).toBe("reading…");
  });

  it("speaks a 409 on a model switch as the agent working", () => {
    const err = Object.assign(new Error("agent is busy"), { status: 409 });
    expect(modelRefusal(err, "api")).toBe("api is working; the model can change when it stops (agent is busy)");
    expect(modelRefusal(new Error("unknown model"), "api")).toBe("unknown model");
  });

  it("reads aloud without markdown marks or code", () => {
    expect(speakable("**Done**. See [the doc](https://x).\n```\ncode\n```")).toBe("Done. See the doc.\n ");
  });
});
