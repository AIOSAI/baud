import { afterEach, describe, expect, it, vi } from "vitest";

import { withRef } from "./errorRef";
import { agentSettingsRead, agentSettingsWrite } from "./index";
import { call } from "./transport.http";

vi.mock("./transport", () => import("./transport.http"));

const SENTENCE = "This read was refused; the reason is in this host's log";

describe("withRef", () => {
  it("appends the ref in one short form after the server's sentence", () => {
    expect(withRef(SENTENCE, "a1b2c3d4e5f6")).toBe(`${SENTENCE} (ref a1b2c3d4e5f6)`);
  });

  it("leaves the sentence untouched when no ref arrived", () => {
    expect(withRef(SENTENCE, undefined)).toBe(SENTENCE);
    expect(withRef(SENTENCE, null)).toBe(SENTENCE);
  });

  it("adds nothing for a blank ref", () => {
    expect(withRef(SENTENCE, "")).toBe(SENTENCE);
    expect(withRef(SENTENCE, "   ")).toBe(SENTENCE);
  });

  it("adds nothing for a ref that is not a string", () => {
    expect(withRef(SENTENCE, 42)).toBe(SENTENCE);
  });

  it("trims the ref it prints", () => {
    expect(withRef(SENTENCE, " a1b2 ")).toBe(`${SENTENCE} (ref a1b2)`);
  });
});

/* THE WIRE, WITH NOTHING ON IT. `fetch` and the token store are stubbed, so
   these drive the transport's real refusal path - `errorFrom` - without a
   request leaving the test. */
describe("a refusal through the transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answers(status: number, body: unknown) {
    vi.stubGlobal("window", { localStorage: { getItem: () => "stub-token" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  it("ends the HostError's message with the envelope's ref, code and status kept", async () => {
    answers(400, { error: { code: "read_refused", message: SENTENCE, ref: "a1b2c3d4e5f6" } });
    await expect(call("git_remote", { branch: "devpulse" })).rejects.toMatchObject({
      name: "HostError",
      status: 400,
      code: "read_refused",
      message: `${SENTENCE} (ref a1b2c3d4e5f6)`,
    });
  });

  it("reads a refusal with no ref exactly as before", async () => {
    answers(404, { error: { code: "not_found", message: "Unknown branch: 'baud'" } });
    await expect(call("git_remote", { branch: "baud" })).rejects.toMatchObject({
      code: "not_found",
      message: "Unknown branch: 'baud'",
    });
  });
});

/* The settings sheet opens from any card, and an agent outside the seat is
   unknown to the seat's registry: the card's project must reach the host. */
describe("agent settings on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function recorded() {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("window", { localStorage: { getItem: () => "stub-token" } });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("reads a foreign agent's settings with its project on the query", async () => {
    const fetch = recorded();
    await agentSettingsRead("vera", "VERA-STUDIO");
    expect(fetch.mock.calls[0][0]).toBe("/v1/agent-settings?branch=vera&project=VERA-STUDIO");
  });

  it("writes a foreign agent's settings with its project in the body", async () => {
    const fetch = recorded();
    const patch = { auto_compact_enabled: false, model: null };
    await agentSettingsWrite("vera", patch, "VERA-STUDIO");
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ branch: "vera", patch, project: "VERA-STUDIO" });
  });

  it("sends no project for a seat agent, on the read or the write", async () => {
    const fetch = recorded();
    await agentSettingsRead("devpulse");
    await agentSettingsWrite("devpulse", { model: null });
    expect(fetch.mock.calls[0][0]).toBe("/v1/agent-settings?branch=devpulse");
    expect(fetch.mock.calls[1][0]).toBe("/v1/agent-settings");
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ branch: "devpulse", patch: { model: null } });
  });
});
