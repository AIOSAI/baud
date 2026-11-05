import { describe, expect, it } from "vitest";

import { asPanelToWorker, asTabToWorker, asWorkerToPanel, asWorkerToTab, isPanelSender, isTabSender } from "./messages";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const PANEL = `chrome-extension://${ID}/sidepanel.html`;
const tab = { id: 7, windowId: 1, active: true };

describe("sender checks", () => {
  it("accepts this extension's script on an http(s) page only", () => {
    expect(isTabSender({ id: ID, url: "https://example.com/a", tab }, ID)).toBe(true);
    expect(isTabSender({ id: ID, url: "http://example.com/", tab }, ID)).toBe(true);
    expect(isTabSender({ id: "other", url: "https://example.com/", tab }, ID)).toBe(false);
    expect(isTabSender({ id: ID, url: "file:///etc/passwd", tab }, ID)).toBe(false);
    expect(isTabSender({ id: ID, url: "https://example.com/" }, ID)).toBe(false);
    expect(isTabSender(undefined, ID)).toBe(false);
    expect(isTabSender({ id: undefined, url: "https://x/", tab }, undefined)).toBe(false);
  });

  it("accepts the side panel page only, never from a tab", () => {
    expect(isPanelSender({ id: ID, url: PANEL }, ID, PANEL)).toBe(true);
    expect(isPanelSender({ id: ID, url: PANEL, tab }, ID, PANEL)).toBe(false);
    expect(isPanelSender({ id: ID, url: `chrome-extension://${ID}/options.html` }, ID, PANEL)).toBe(false);
    expect(isPanelSender({ id: "other", url: PANEL }, ID, PANEL)).toBe(false);
  });
});

describe("content -> worker", () => {
  it("keeps good shapes and caps text", () => {
    expect(asTabToWorker({ type: "ping" })).toEqual({ type: "ping" });
    expect(asTabToWorker({ type: "interact", on: false })).toEqual({ type: "interact", on: false });
    const look = asTabToWorker({ type: "look", kind: "pin", text: "x".repeat(5000), title: "T", page: "https://a/b", extra: 1 });
    expect(look).toEqual({ type: "look", kind: "pin", text: "x".repeat(1000), title: "T", page: "https://a/b" });
  });

  it("refuses bad shapes", () => {
    for (const bad of [
      null,
      "look",
      [],
      { type: "interact", on: true },
      { type: "look", kind: "elsewhere", text: "", title: "", page: "" },
      { type: "look", kind: "pointer", text: 3, title: "", page: "" },
      { type: "look", kind: "pointer", text: "", page: "" },
      { type: "state" },
    ]) {
      expect(asTabToWorker(bad)).toBeNull();
    }
  });
});

describe("worker -> content", () => {
  it("rebuilds a state and clamps numbers", () => {
    const m = asWorkerToTab({
      type: "state",
      mode: "acting",
      speaker: 3,
      eyes: { on: false, hue: 400 },
      interact: true,
      rings: [{ working: true, dispatched: false, subagents: 2.7 }, "junk", { subagents: -1 }],
    });
    expect(m).toEqual({
      type: "state",
      mode: "acting",
      speaker: 1,
      eyes: { on: false, hue: 40 },
      interact: true,
      rings: [
        { working: true, dispatched: false, subagents: 2 },
        { working: false, dispatched: false, subagents: 0 },
      ],
    });
    expect(asWorkerToTab({ type: "unpin" })).toEqual({ type: "unpin" });
  });

  it("refuses an unknown mode or missing eyes", () => {
    expect(asWorkerToTab({ type: "state", mode: "dancing", speaker: 0, eyes: { on: true }, interact: true, rings: [] })).toBeNull();
    expect(asWorkerToTab({ type: "state", mode: "idle", speaker: 0, interact: true, rings: [] })).toBeNull();
  });
});

describe("panel <-> worker", () => {
  it("panel messages", () => {
    expect(asPanelToWorker({ type: "hello" })).toEqual({ type: "hello" });
    expect(asPanelToWorker({ type: "agent", agent: "aipass/api" })).toEqual({ type: "agent", agent: "aipass/api" });
    expect(asPanelToWorker({ type: "agent", agent: null })).toEqual({ type: "agent", agent: null });
    expect(asPanelToWorker({ type: "agent", agent: "noslash" })).toBeNull();
    expect(
      asPanelToWorker({ type: "orb", busy: true, waiting: false, acting: true, speaking: false, loudness: -2 }),
    ).toEqual({ type: "orb", busy: true, waiting: false, acting: true, speaking: false, loudness: 0 });
    expect(asPanelToWorker({ type: "orb", busy: true, loudness: 0 })).toBeNull();
    expect(asPanelToWorker({ type: "eyes", on: true, hue: "red" })).toEqual({ type: "eyes", on: true, hue: 187 });
    expect(asPanelToWorker({ type: "interact", toggle: true })).toEqual({ type: "interact", toggle: true });
    expect(asPanelToWorker({ type: "interact" })).toBeNull();
    expect(asPanelToWorker({ type: "send", text: "rm -rf" })).toBeNull();
  });

  it("worker messages", () => {
    const look = { kind: "selection", text: 'Selected: "x"', title: "T", page: "https://a/", pinned: false };
    expect(asWorkerToPanel({ type: "look", look })).toEqual({ type: "look", look });
    expect(asWorkerToPanel({ type: "look", look: { ...look, pinned: "yes" } })).toBeNull();
    expect(asWorkerToPanel({ type: "interact", on: false, can: true })).toEqual({ type: "interact", on: false, can: true });
    expect(asWorkerToPanel({ type: "fleet", branches: [{ name: "a" }, 1], error: null })).toEqual({
      type: "fleet",
      branches: [{ name: "a" }],
      error: null,
    });
    expect(asWorkerToPanel({ type: "fleet", branches: {}, error: null })).toBeNull();
  });
});
