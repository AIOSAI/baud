import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentFeed, agentInterrupt, agentModel, agentSend, agentUsage, speak } from "../../host";
import { configureHost, redeemPairing } from "../../host/transport.http";
import { modelRefusal, usageWhy } from "./chat";
import { failed, lookOf, type Pending } from "./pending";

vi.mock("../../host/transport", () => import("../../host/transport.http"));

type Call = [string, RequestInit];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  configureHost("http://h:8787", "tok");
  fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureHost("", null);
});

describe("the chat's host verbs against a faked host", () => {
  it("pages the feed by `since`, the agent's segments encoded", async () => {
    fetch.mockResolvedValueOnce(json({ lines: [{ n: 1, role: "user", text: "hi", time: "t" }], busy: true, waiting: null }));
    fetch.mockResolvedValueOnce(json({ lines: [], busy: false, waiting: { tool: "Bash" } }));
    const first = await agentFeed("AI Pass/api");
    const next = await agentFeed("AI Pass/api", 1);
    const [u1, init] = fetch.mock.calls[0] as Call;
    const [u2] = fetch.mock.calls[1] as Call;
    expect(u1).toBe("http://h:8787/v1/agent/AI%20Pass/api/feed");
    expect(u2).toBe("http://h:8787/v1/agent/AI%20Pass/api/feed?since=1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(first.busy).toBe(true);
    expect(next.waiting).toEqual({ tool: "Bash" });
  });

  it("refuses an agent name that is not <project>/<name> before any request", async () => {
    for (const bad of ["api", "a/b/c", "../x", "a/.."]) await expect(agentFeed(bad)).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the text; a 409 leaves the send pending with the host's words", async () => {
    fetch.mockResolvedValueOnce(json({ error: { code: "no_room", message: "api has no room" } }, 409));
    let list: Pending[] = [{ id: 1, sent: "hi", shown: "hi", at: 0, failed: null }];
    await agentSend("aipass/api", "hi").catch((err: Error) => (list = failed(list, 1, err.message)));
    const [url, init] = fetch.mock.calls[0] as Call;
    expect(url).toBe("http://h:8787/v1/agent/aipass/api/send");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ text: "hi" });
    expect(lookOf(list[0], 0)).toBe("failed");
    expect(list[0].failed).toBe("api has no room");
  });

  it("interrupts with an empty POST", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await agentInterrupt("aipass/api");
    const [url, init] = fetch.mock.calls[0] as Call;
    expect(url).toBe("http://h:8787/v1/agent/aipass/api/interrupt");
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("sends a model pick as { provider, model, effort } and words a 409", async () => {
    fetch.mockResolvedValueOnce(json({ typed: "/model opus" }));
    fetch.mockResolvedValueOnce(json({ error: { code: "busy", message: "api is working" } }, 409));
    expect(await agentModel("aipass/api", { provider: "claude", model: "opus", effort: "high" })).toEqual({ typed: "/model opus" });
    expect(JSON.parse(String((fetch.mock.calls[0] as Call)[1].body))).toEqual({ provider: "claude", model: "opus", effort: "high" });
    const err = await agentModel("aipass/api", { provider: "codex" }).catch((e: unknown) => e);
    expect(JSON.parse(String((fetch.mock.calls[1] as Call)[1].body))).toEqual({ provider: "codex" });
    expect(modelRefusal(err, "api")).toBe("api is working; the model can change when it stops (api is working)");
  });

  it("reads usage and its note when unavailable", async () => {
    fetch.mockResolvedValueOnce(json({ provider: "opencode", context: null, limits: [], note: "OpenCode usage is not wired yet" }));
    const u = await agentUsage("aipass/api");
    expect((fetch.mock.calls[0] as Call)[0]).toBe("http://h:8787/v1/agent/aipass/api/usage");
    expect(usageWhy(u, null)).toBe("OpenCode usage is not wired yet");
  });

  it("streams speech with its sample rate, and refuses a stream without one", async () => {
    fetch.mockResolvedValueOnce(new Response(new Uint8Array([0, 0]), { status: 200, headers: { "X-Sample-Rate": "22050" } }));
    const got = await speak("hello");
    expect(got.rate).toBe(22050);
    expect((fetch.mock.calls[0] as Call)[0]).toBe("http://h:8787/v1/speak");
    expect(((fetch.mock.calls[0] as Call)[1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    fetch.mockResolvedValueOnce(new Response(new Uint8Array([0, 0]), { status: 200 }));
    await expect(speak("hello")).rejects.toMatchObject({ code: "no_rate" });
  });

  it("redeems a pairing code at the configured host, with no bearer", async () => {
    configureHost("http://h:8787", null);
    fetch.mockResolvedValueOnce(json({ token: "fresh", id: "p1", label: "extension", scope: "operate" }));
    expect((await redeemPairing("ABC-123")).token).toBe("fresh");
    const [url, init] = fetch.mock.calls[0] as Call;
    expect(url).toBe("http://h:8787/v1/pair");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ code: "ABC-123" });
  });
});
