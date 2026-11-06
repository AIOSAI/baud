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
  agentModel: vi.fn(),
  modelsList: vi.fn(),
  uploadImage: vi.fn(),
  speak: vi.fn(),
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
const labelled = (label: string, n = 0) => box.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[n];
const typeInto = (field: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

/** Web Audio as far as the player touches it: each context, its sources, and what was asked of it. */
class FakeAudio {
  static made: FakeAudio[] = [];
  currentTime = 0;
  destination = {};
  sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  suspend = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  constructor() {
    FakeAudio.made.push(this);
  }
  createAnalyser() {
    return { fftSize: 0, connect: () => undefined, getFloatTimeDomainData: () => undefined };
  }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createBufferSource() {
    const s = { buffer: null, onended: null, connect: () => undefined, start: vi.fn(), stop: vi.fn() };
    this.sources.push(s);
    return s;
  }
}

/** One second of silence at 8 kHz, then the end. */
const speech = () => {
  const chunks = [{ done: false, value: new Uint8Array(16000) }, { done: true, value: undefined }];
  return { rate: 8000, body: { getReader: () => ({ read: async () => chunks.shift()! }) } };
};

beforeEach(async () => {
  vi.useFakeTimers({ now: T0 });
  for (const f of Object.values(host)) f.mockReset().mockResolvedValue({});
  host.agentUsage.mockResolvedValue({ provider: "claude", context: null });
  FakeAudio.made = [];
  vi.stubGlobal("AudioContext", FakeAudio);
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
});

afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

  it("reads a reply aloud: play, pause, back 10 s, stop, and a new play stops the old", async () => {
    host.agentFeed.mockResolvedValue(
      feed({
        lines: [
          { n: 1, role: "agent", text: "**first** reply", time: at(-60) },
          { n: 2, role: "agent", text: "second reply", time: at(-50) },
        ],
      }),
    );
    host.speak.mockImplementation(async () => speech());
    await mount();
    act(() => labelled("read aloud", 0).click());
    // The context exists before the speech arrives: made inside the tap, as a phone requires.
    expect(FakeAudio.made).toHaveLength(1);
    expect(host.speak).toHaveBeenCalledWith("first reply", expect.any(AbortSignal));
    await flush();
    const first = FakeAudio.made[0];
    expect(first.sources).toHaveLength(1);

    await act(async () => labelled("pause").click());
    expect(first.suspend).toHaveBeenCalled();
    expect(labelled("resume")).toBeTruthy();
    await act(async () => labelled("resume").click());
    expect(first.resume).toHaveBeenCalled();

    first.currentTime = 0.5;
    await act(async () => labelled("back 10 seconds").click());
    expect(first.sources[0].stop).toHaveBeenCalled();
    expect(first.sources).toHaveLength(2);
    expect(first.sources[1].start).toHaveBeenCalledWith(0.55, 0);

    act(() => labelled("read aloud", 0).click());
    expect(first.close).toHaveBeenCalled();
    await flush();
    expect(labelled("pause")).toBeTruthy();

    await act(async () => labelled("stop reading").click());
    expect(FakeAudio.made[1].close).toHaveBeenCalled();
    expect(labelled("pause")).toBeUndefined();
    expect(box.querySelectorAll('button[aria-label="read aloud"]')).toHaveLength(2);
  });

  it("switches the model from the head's label and says what was typed, or why not", async () => {
    host.agentFeed.mockResolvedValue(feed({ lines: [{ n: 1, role: "agent", text: "hi", time: at(-5), model: "opus" }] }));
    host.modelsList.mockResolvedValue({ claude: { models: [{ name: "opus", efforts: ["high"] }] }, switch: {} });
    host.agentModel.mockResolvedValue({ typed: "/model opus" });
    await mount();
    await act(async () => box.querySelector<HTMLButtonElement>(".baud-chat-model")!.click());
    await flush();
    expect(box.querySelector(".baud-chat-prov")?.textContent).toBe("ClaudeCodexOpenCode");
    await act(async () => button("high")!.click());
    await flush();
    expect(host.agentModel).toHaveBeenCalledWith("AIPass/devpulse", { provider: "claude", model: "opus", effort: "high" });
    expect(box.querySelector(".baud-chat-note")?.textContent).toBe("switched devpulse to Opus high, typed /model opus; pending its next reply");
    expect(box.querySelector(".baud-chat-menu")).toBeNull();

    host.agentModel.mockRejectedValue(Object.assign(new Error("the agent is mid-turn"), { status: 409 }));
    await act(async () => box.querySelector<HTMLButtonElement>(".baud-chat-model")!.click());
    await flush();
    await act(async () => button("Opus")!.click());
    await flush();
    expect(host.agentModel).toHaveBeenLastCalledWith("AIPass/devpulse", { provider: "claude", model: "opus" });
    expect(box.querySelector('[role="alert"]')?.textContent).toBe(
      "could not switch devpulse to Opus: devpulse is working; the model can change when it stops (the agent is mid-turn)",
    );
  });

  it("shows the usage ring, opens the usage sheet on a tap, and reads again every 30 s", async () => {
    host.agentFeed.mockResolvedValue(feed({}));
    host.agentUsage.mockResolvedValue({
      provider: "claude",
      context: { used: 42000, total: 200000, percent: 21 },
      limits: [{ label: "5-hour", percent: 80, severity: "warning", resets_at: null }],
      note: "limits from the statusline",
    });
    await mount();
    const ring = box.querySelector<HTMLButtonElement>(".baud-chat-ring")!;
    expect(ring.dataset.severity).toBe("warning");
    expect(ring.title).toBe("context 21% used");
    expect(box.querySelector(".baud-chat-ring-fill")?.getAttribute("stroke-dasharray")).toMatch(/^9\.23\d* 43\.98/);
    await act(async () => ring.click());
    const sheet = box.querySelector('[role="dialog"][aria-label="usage"]')!.textContent;
    for (const said of ["Context window", "21%", "42.0k of 200k tokens", "Plan limits", "5-hour", "80%", "reset time not given", "limits from the statusline"]) {
      expect(sheet).toContain(said);
    }
    expect(host.agentUsage).toHaveBeenCalledTimes(1);
    await wait(30_000);
    expect(host.agentUsage).toHaveBeenCalledTimes(2);
  });

  it("puts a photo in as an image tag and sends its host path", async () => {
    host.agentFeed.mockResolvedValue(feed({}));
    host.uploadImage.mockResolvedValue("/tmp/baud-uploads/cat.png");
    await mount();
    const field = box.querySelector("textarea")!;
    await typeInto(field, "look at");
    const picker = box.querySelector<HTMLInputElement>('input[type="file"]')!;
    const photo = new File(["x"], "cat.png", { type: "image/png" });
    Object.defineProperty(picker, "files", { value: [photo], configurable: true });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(host.uploadImage).toHaveBeenCalledWith(photo);
    expect(field.value).toBe("look at [Image #1] ");
    await act(async () => box.querySelector("form")!.requestSubmit());
    expect(host.agentSend).toHaveBeenCalledWith("AIPass/devpulse", "look at /tmp/baud-uploads/cat.png");
    expect(box.querySelector(".baud-chat-pend .baud-chat-text")?.textContent).toBe("look at [Image #1]");
  });
});
