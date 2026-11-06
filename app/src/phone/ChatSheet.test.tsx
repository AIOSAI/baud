// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentFeed } from "../types";
import ChatSheet from "./ChatSheet";

const host = vi.hoisted(() => ({
  agentFeed: vi.fn(),
  agentSend: vi.fn(),
  agentInterrupt: vi.fn(),
  agentAllow: vi.fn(),
  agentDeny: vi.fn(),
  agentUsage: vi.fn(),
}));
vi.mock("../host", () => host);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.parse("2026-11-06T10:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const feed = (over: Partial<AgentFeed>): AgentFeed => ({ lines: [], busy: false, waiting: null, session: "s1", ...over });

let root: Root;
let box: HTMLDivElement;

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const button = (word: string) => [...box.querySelectorAll("button")].find((b) => b.textContent?.trim() === word);

beforeEach(async () => {
  vi.useFakeTimers({ now: T0 });
  for (const f of Object.values(host)) f.mockReset().mockResolvedValue({});
  host.agentUsage.mockResolvedValue({ provider: "claude", context: null });
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
});

afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.useRealTimers();
});

const mount = async () => {
  await act(async () => root.render(<ChatSheet agent="AIPass/devpulse" onClose={() => undefined} />));
  await flush();
};

describe("ChatSheet", () => {
  it("opens on the agent's feed, its reply as markdown, labelled with the model", async () => {
    host.agentFeed.mockResolvedValue(
      feed({
        lines: [
          { n: 1, role: "user", text: "hello", time: at(-60) },
          { n: 2, role: "agent", text: "**hi** there", time: at(-50), model: "opus" },
        ],
      }),
    );
    await mount();
    expect(host.agentFeed).toHaveBeenCalledWith("AIPass/devpulse", undefined);
    expect(box.textContent).toContain("devpulse · chat");
    expect(box.querySelector(".baud-chat-user")?.textContent).toContain("hello");
    expect(box.querySelector(".baud-chat-agent strong")?.textContent).toBe("hi");
    expect(box.querySelector(".baud-chat-model")?.textContent).toBe("opus");
  });

  it("shows a send as pending until the feed echoes the line", async () => {
    host.agentFeed.mockResolvedValue(feed({}));
    await mount();
    const field = box.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "ship it");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    host.agentFeed.mockResolvedValue(feed({ lines: [{ n: 1, role: "user", text: "ship it", time: at(1) }] }));
    await act(async () => box.querySelector("form")!.requestSubmit());
    expect(host.agentSend).toHaveBeenCalledWith("AIPass/devpulse", "ship it");
    expect(box.querySelector(".baud-chat-pend")?.textContent).toContain("waiting for devpulse");
    await wait(700);
    expect(box.querySelector(".baud-chat-pend")).toBeNull();
    expect(box.querySelector(".baud-chat-user")?.textContent).toContain("ship it");
  });

  it.each([
    ["allow", "agentAllow", "allowed"],
    ["deny", "agentDeny", "denied, and the turn stopped"],
  ] as const)("offers %s while the feed waits on a tool, and it calls %s", async (word, verb, said) => {
    host.agentFeed.mockResolvedValue(feed({ busy: true, waiting: { tool: "Bash" } }));
    await mount();
    expect(box.querySelector(".baud-chat-busy")?.textContent).toContain("waiting for your permission: Bash");
    expect(button("allow")).toBeTruthy();
    expect(button("deny")).toBeTruthy();
    await act(async () => button(word)!.click());
    expect(host[verb]).toHaveBeenCalledWith("AIPass/devpulse");
    expect(box.querySelector(".baud-chat-busy")?.textContent).toContain(said);
  });
});
